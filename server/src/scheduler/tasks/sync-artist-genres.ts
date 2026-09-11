import { registerTask } from '../scheduler.js';
import { runArtistGenreSync } from '../../spotify/artist-genre-sync.js';

/** Budget per run; the scheduler's task timeout is 5 minutes. */
export const ARTIST_GENRE_SYNC_BUDGET_MS = 4 * 60 * 1000;

/**
 * Register the artist-genre sync as its own task: every 30 minutes, bounded
 * to 4 minutes per run and resumable, so a large library fills in hours and
 * the 6-hour full library sync stays fast.
 */
export function registerArtistGenreSyncTask(): void {
  registerTask({
    name: 'artist-genre-sync',
    schedule: '*/30 * * * *',
    handler: async () => {
      await runArtistGenreSync({ maxDurationMs: ARTIST_GENRE_SYNC_BUDGET_MS });
    },
    runOnStart: true,
  });
}
