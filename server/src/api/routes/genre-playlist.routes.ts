import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getGenreSummary,
  previewGenrePlaylist,
  getArtistLikedTracks,
  orderTrackIdsSmooth,
} from '../../intelligence/genre-playlist.js';
import { searchLikedArtists, getTracksByIds, hasRealFeatures } from '../../database/repositories/genre-playlist.repo.js';
import { insertPlaylistWithTracks } from '../../database/repositories/playlist.repo.js';
import {
  runArtistGenreSync,
  isGenreSyncRunning,
  getGenreSyncProgress,
  genreSyncEvents,
} from '../../spotify/artist-genre-sync.js';
import { createSpotifyPlaylist, addTracksToPlaylist } from '../../spotify/player.js';
import { PlaylistPartialError } from '../../shared/errors.js';
import { broadcast } from '../websocket.js';
import { logger } from '../../shared/logger.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const UNIT = z.number().min(0).max(1);

const previewSchema = z.object({
  families: z.array(z.string()).default([]),
  includeGenres: z.array(z.string()).default([]),
  excludeGenres: z.array(z.string()).default([]),
  likedFrom: DATE.nullable().default(null),
  likedTo: DATE.nullable().default(null),
  energyMin: UNIT.nullable().default(null),
  energyMax: UNIT.nullable().default(null),
}).refine((b) => b.families.length > 0 || b.includeGenres.length > 0, {
  message: 'Select at least one family or genre',
});

const orderSchema = z.object({ trackIds: z.array(z.number().int()).min(1).max(10000) });

const exportSchema = z.object({
  trackIds: z.array(z.number().int()).min(1).max(10000),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(300).default(''),
  isPublic: z.boolean().default(false),
  families: z.array(z.string()).default([]),
});

function parseOr400<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    });
    return null;
  }
  return result.data;
}

let progressWired = false;
let exportInProgress = false;

/** Prefix: /api/library */
export async function libraryRoutes(fastify: FastifyInstance): Promise<void> {
  if (!progressWired) {
    genreSyncEvents.on('progress', (data) => broadcast({ type: 'genre_sync_progress', data }));
    progressWired = true;
  }

  fastify.get('/genres', async () => ({
    ...getGenreSummary(),
    genreSyncProgress: getGenreSyncProgress(),
  }));

  fastify.post('/genres/sync', async (_request, reply) => {
    if (isGenreSyncRunning()) {
      return reply.status(409).send({ error: 'SYNC_IN_PROGRESS', message: 'Genre sync already running' });
    }
    runArtistGenreSync().catch((err) => logger.error({ err }, 'Manual genre sync failed'));
    return reply.status(202).send({ started: true });
  });

  fastify.get('/artists', async (request) => {
    const q = String((request.query as Record<string, string>).q ?? '').trim();
    return { artists: q.length === 0 ? [] : searchLikedArtists(q, 20) };
  });

  fastify.get('/artists/:artistId/liked-tracks', async (request, reply) => {
    const { artistId } = request.params as { artistId: string };
    const tracks = getArtistLikedTracks(artistId);
    if (!tracks) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Artist has no liked tracks' });
    return { tracks };
  });
}

/** Prefix: /api/genre-playlists */
export async function genrePlaylistRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/preview', async (request, reply) => {
    const filters = parseOr400(previewSchema, request.body, reply);
    if (!filters) return reply;
    return previewGenrePlaylist(filters);
  });

  fastify.post('/order', async (request, reply) => {
    const body = parseOr400(orderSchema, request.body, reply);
    if (!body) return reply;
    if (!hasRealFeatures()) {
      return reply.status(400).send({ error: 'FEATURES_UNAVAILABLE', message: 'Audio features are not available' });
    }
    return { trackIds: orderTrackIdsSmooth(body.trackIds) };
  });

  fastify.post('/export', async (request, reply) => {
    const body = parseOr400(exportSchema, request.body, reply);
    if (!body) return reply;
    if (exportInProgress) {
      return reply.status(409).send({ error: 'EXPORT_IN_PROGRESS', message: 'An export is already running' });
    }

    const byId = new Map(getTracksByIds(body.trackIds).map((t) => [t.id, t]));
    const missing = body.trackIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return reply.status(400).send({ error: 'UNKNOWN_TRACKS', message: `Unknown track ids: ${missing.slice(0, 10).join(', ')}` });
    }
    const ordered = body.trackIds.map((id) => byId.get(id)!);
    const uris = ordered.map((t) => `spotify:track:${t.spotify_id}`);

    exportInProgress = true;
    const start = Date.now();
    try {
      const { id: spotifyPlaylistId, url: spotifyPlaylistUrl } =
        await createSpotifyPlaylist(body.name, body.description, body.isPublic);

      let addedCount: number;
      let partial = false;
      try {
        addedCount = await addTracksToPlaylist(spotifyPlaylistId, uris, (added) =>
          broadcast({ type: 'genre_playlist_export_progress', data: { added, total: uris.length } }),
        );
      } catch (err) {
        if (!(err instanceof PlaylistPartialError)) throw err;
        logger.warn({ err, spotifyPlaylistId }, 'Genre playlist export partially failed');
        addedCount = err.addedCount;
        partial = true;
      }

      const kept = ordered.slice(0, addedCount);
      const totalDurationMs = kept.reduce((sum, t) => sum + t.duration_ms, 0);
      const id = insertPlaylistWithTracks(
        {
          prompt: `genre:${body.families.join(',')}`,
          name: body.name,
          description: body.description,
          durationMinutes: Math.round(totalDurationMs / 60000),
          discoveryRate: 0,
          energyArc: 'steady',
          transitionSmoothness: 0,
          maxPerArtist: 0,
          seedTrackId: null,
          sourcePreference: 'library',
          spotifyPlaylistId,
          spotifyPlaylistUrl,
          trackCount: kept.length,
          totalDurationMs,
          generationTimeMs: Date.now() - start,
          aiEnhanced: false,
        },
        kept.map((t, i) => ({ trackId: t.id, position: i + 1, score: null, segment: null })),
      );

      return { id, spotifyPlaylistId, spotifyPlaylistUrl, trackCount: kept.length, addedCount, partial };
    } finally {
      exportInProgress = false;
    }
  });
}
