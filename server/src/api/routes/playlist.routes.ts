import type { FastifyInstance } from 'fastify';
import {
  getPlaylistById,
  getPlaylistTracks,
  getPlaylists,
  getPlaylistCount,
  deletePlaylist,
} from '../../database/repositories/playlist.repo.js';
import { generatePlaylist, type PlaylistGenerationRequest, type EnergyArc } from '../../intelligence/playlist-generator.js';
import { broadcast } from '../websocket.js';
import { logger } from '../../shared/logger.js';
import {
  PLAYLIST_MAX_DURATION_MINUTES,
  PLAYLIST_MIN_DURATION_MINUTES,
} from '../../shared/constants.js';

const VALID_ENERGY_ARCS: EnergyArc[] = ['steady', 'build_up', 'wind_down', 'peak_and_fade'];

let generationInProgress = false;

export async function playlistRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/playlists/generate
   * Generate a curated playlist from a natural language prompt.
   */
  fastify.post('/generate', async (request, reply) => {
    if (generationInProgress) {
      return reply.status(409).send({
        error: 'GENERATION_IN_PROGRESS',
        message: 'A playlist is already being generated. Please wait.',
      });
    }

    const body = request.body as Record<string, any> | undefined;

    if (!body?.prompt || typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
      return reply.status(400).send({ error: 'MISSING_PROMPT', message: 'A prompt is required' });
    }

    if (body.prompt.length > 500) {
      return reply.status(400).send({ error: 'PROMPT_TOO_LONG', message: 'Prompt must be 500 characters or less' });
    }

    if (!body.durationMinutes || typeof body.durationMinutes !== 'number') {
      return reply.status(400).send({ error: 'MISSING_DURATION', message: 'Duration in minutes is required' });
    }

    const durationMinutes = Math.max(
      PLAYLIST_MIN_DURATION_MINUTES,
      Math.min(PLAYLIST_MAX_DURATION_MINUTES, body.durationMinutes),
    );

    const energyArc = VALID_ENERGY_ARCS.includes(body.energyArc) ? body.energyArc : 'steady';
    const sourcePreference = body.sourcePreference === 'library_and_spotify' ? 'library_and_spotify' : 'library';

    const genRequest: PlaylistGenerationRequest = {
      prompt: body.prompt.trim(),
      durationMinutes,
      discoveryRate: clamp(body.discoveryRate ?? 0.3, 0, 1),
      energyArc,
      transitionSmoothness: clamp(body.transitionSmoothness ?? 0.5, 0, 1),
      maxPerArtist: Math.max(1, Math.min(10, Math.round(body.maxPerArtist ?? 3))),
      seedTrackId: typeof body.seedTrackId === 'number' ? body.seedTrackId : null,
      sourcePreference,
      createSpotifyPlaylist: body.createSpotifyPlaylist !== false,
    };

    generationInProgress = true;
    try {
      const result = await generatePlaylist(genRequest);

      broadcast({
        type: 'playlist_generation_complete',
        data: {
          playlistId: result.id,
          name: result.name,
          trackCount: result.tracks.length,
          spotifyPlaylistUrl: result.spotifyPlaylistUrl,
        },
      });

      return {
        success: true,
        playlist: {
          id: result.id,
          name: result.name,
          description: result.description,
          trackCount: result.tracks.length,
          totalDurationMs: result.totalDurationMs,
          spotifyPlaylistId: result.spotifyPlaylistId,
          spotifyPlaylistUrl: result.spotifyPlaylistUrl,
          generationTimeMs: result.generationTimeMs,
          aiEnhanced: result.aiEnhanced,
          tracks: result.tracks.map((t) => ({
            position: t.position,
            name: t.track.name,
            artist: t.track.artist,
            album: t.track.album,
            albumArtUrl: t.track.album_art_url,
            durationMs: t.track.duration_ms,
            spotifyId: t.track.spotify_id,
            score: Math.round(t.score * 100) / 100,
            segment: t.segment,
          })),
        },
      };
    } catch (err: any) {
      logger.error({ err }, 'Playlist generation failed');

      broadcast({
        type: 'playlist_generation_error',
        data: { message: err.message ?? 'Playlist generation failed' },
      });

      return reply.status(500).send({
        error: 'GENERATION_FAILED',
        message: err.message ?? 'Playlist generation failed',
      });
    } finally {
      generationInProgress = false;
    }
  });

  /**
   * GET /api/playlists
   * List generated playlists (paginated).
   */
  fastify.get('/', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = Math.max(1, Math.min(50, parseInt(query.limit ?? '20', 10) || 20));
    const offset = Math.max(0, parseInt(query.offset ?? '0', 10) || 0);

    const playlists = getPlaylists(limit, offset);
    const total = getPlaylistCount();

    return {
      playlists: playlists.map(formatPlaylistRow),
      total,
      limit,
      offset,
    };
  });

  /**
   * GET /api/playlists/:id
   * Get a single playlist with all tracks.
   */
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const playlistId = parseInt(id, 10);

    if (isNaN(playlistId)) {
      return reply.status(400).send({ error: 'INVALID_ID', message: 'Invalid playlist ID' });
    }

    const playlist = getPlaylistById(playlistId);
    if (!playlist) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Playlist not found' });
    }

    const tracks = getPlaylistTracks(playlistId);

    return {
      playlist: formatPlaylistRow(playlist),
      tracks: tracks.map((t) => ({
        position: t.position,
        name: t.name,
        artist: t.artist,
        album: t.album,
        albumArtUrl: t.album_art_url,
        durationMs: t.duration_ms,
        spotifyId: t.spotify_id,
        score: t.score != null ? Math.round(t.score * 100) / 100 : null,
        segment: t.segment,
      })),
    };
  });

  /**
   * DELETE /api/playlists/:id
   * Delete a playlist from local DB (does NOT delete from Spotify).
   */
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const playlistId = parseInt(id, 10);

    if (isNaN(playlistId)) {
      return reply.status(400).send({ error: 'INVALID_ID', message: 'Invalid playlist ID' });
    }

    const playlist = getPlaylistById(playlistId);
    if (!playlist) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Playlist not found' });
    }

    deletePlaylist(playlistId);
    return { success: true };
  });
}

// ── Helpers ──────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (typeof value !== 'number' || isNaN(value)) return (min + max) / 2;
  return Math.max(min, Math.min(max, value));
}

function formatPlaylistRow(row: import('../../database/types.js').PlaylistRow) {
  return {
    id: row.id,
    prompt: row.prompt,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    discoveryRate: row.discovery_rate,
    energyArc: row.energy_arc,
    transitionSmoothness: row.transition_smoothness,
    maxPerArtist: row.max_per_artist,
    sourcePreference: row.source_preference,
    spotifyPlaylistId: row.spotify_playlist_id,
    spotifyPlaylistUrl: row.spotify_playlist_url,
    trackCount: row.track_count,
    totalDurationMs: row.total_duration_ms,
    generationTimeMs: row.generation_time_ms,
    aiEnhanced: !!row.ai_enhanced,
    createdAt: row.created_at,
  };
}
