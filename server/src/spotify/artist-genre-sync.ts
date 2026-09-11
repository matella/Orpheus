import { EventEmitter } from 'node:events';
import { spotifyFetch } from './client.js';
import { SpotifyApiError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import { sleep } from '../shared/utils.js';
import {
  backfillPrimaryArtists,
  getArtistsNeedingGenres,
  saveArtistGenres,
  getGenreSyncCounts,
} from '../database/repositories/artist.repo.js';
import { setGenreClusterByArtist } from '../database/repositories/track.repo.js';

export interface GenreSyncProgress {
  done: number;
  total: number;
  running: boolean;
}

/** Emits 'progress' (GenreSyncProgress). Wired to WebSocket in genre-playlist.routes.ts. */
export const genreSyncEvents = new EventEmitter();

let running = false;

export function isGenreSyncRunning(): boolean {
  return running;
}

export function getGenreSyncProgress(): GenreSyncProgress {
  return { ...getGenreSyncCounts(), running };
}

const BATCH = 50;
const PROGRESS_EVERY = 10;

/**
 * Fetch genres for every artist with genres_fetched_at IS NULL, one
 * GET /artists/{id} at a time (batch GET /artists was removed for
 * Development Mode apps in Feb 2026).
 *
 * Throttled by `delayMs` between calls. Stops early (and resumes next run)
 * on 429 (spotifyFetch already retried with Retry-After) or 403, or when
 * `maxDurationMs` elapses. Returns the number of artists processed.
 */
export async function runArtistGenreSync(opts: {
  maxDurationMs?: number;
  delayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
} = {}): Promise<number> {
  if (running) {
    logger.debug('Artist genre sync already running — skipping');
    return 0;
  }
  const { maxDurationMs = Infinity, delayMs = 200, sleepFn = sleep } = opts;
  const deadline = Date.now() + maxDurationMs;
  running = true;
  let processed = 0;

  try {
    backfillPrimaryArtists();
    genreSyncEvents.emit('progress', getGenreSyncProgress());

    outer: while (true) {
      const ids = getArtistsNeedingGenres(BATCH);
      if (ids.length === 0) break;

      for (const id of ids) {
        if (Date.now() >= deadline) {
          logger.info({ processed }, 'Artist genre sync time budget reached — resuming next run');
          break outer;
        }
        try {
          const artist = await spotifyFetch<{ id: string; name: string; genres?: string[] }>(`/artists/${id}`);
          const genres = artist?.genres ?? [];
          saveArtistGenres(id, artist?.name ?? null, genres);
          if (genres.length > 0) setGenreClusterByArtist(id, genres[0]);
        } catch (err) {
          if (err instanceof SpotifyApiError && err.statusCode === 404) {
            saveArtistGenres(id, null, []);
          } else if (err instanceof SpotifyApiError && (err.statusCode === 429 || err.statusCode === 403)) {
            logger.warn({ status: err.statusCode, processed }, 'Artist genre sync stopped by Spotify — resuming next run');
            break outer;
          } else {
            throw err;
          }
        }
        processed++;
        if (processed % PROGRESS_EVERY === 0) genreSyncEvents.emit('progress', getGenreSyncProgress());
        await sleepFn(delayMs);
      }
    }

    logger.info({ processed }, 'Artist genre sync complete');
    return processed;
  } finally {
    running = false;
    genreSyncEvents.emit('progress', getGenreSyncProgress());
  }
}
