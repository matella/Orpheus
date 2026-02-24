import { registerTask } from '../scheduler.js';
import { fullLibrarySync, syncRecentlyPlayed, syncAudioFeatures } from '../../spotify/library.js';

/**
 * Register library sync tasks with the scheduler.
 *
 * - Full sync: every 6 hours (saves tracks + top tracks + recent + audio features)
 * - Recent sync: every 30 minutes (recently played + new audio features)
 */
export function registerLibrarySyncTasks(): void {
  // Full library sync every 6 hours
  registerTask({
    name: 'full-library-sync',
    schedule: '0 */6 * * *', // Every 6 hours at :00
    handler: async () => {
      await fullLibrarySync();
    },
    runOnStart: true, // Sync on server startup
  });

  // Recently played sync every 30 minutes
  registerTask({
    name: 'recent-tracks-sync',
    schedule: '*/30 * * * *', // Every 30 minutes
    handler: async () => {
      await syncRecentlyPlayed();
      await syncAudioFeatures();
    },
    runOnStart: false, // Full sync on start already covers this
  });
}
