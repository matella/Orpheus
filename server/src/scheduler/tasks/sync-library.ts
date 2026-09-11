import { registerTask } from '../scheduler.js';
import {
  fullLibrarySync,
  syncRecentlyPlayed,
  syncAudioFeatures,
  syncTopArtists,
} from '../../spotify/library.js';

/**
 * Register library sync tasks with the scheduler.
 *
 * - Full sync: every 6 hours (saves tracks + top tracks/artists + recent + audio + prefs)
 * - Recent sync: every 15 minutes (recently played + new audio features)
 * - Top artists sync: every 12 hours (Spotify top artists with genre data)
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

  // Recently played sync every 15 minutes
  registerTask({
    name: 'recent-tracks-sync',
    schedule: '*/15 * * * *', // Every 15 minutes
    handler: async () => {
      await syncRecentlyPlayed();
      await syncAudioFeatures();
    },
    runOnStart: false, // Full sync on start already covers this
  });

  // Top artists sync every 12 hours
  registerTask({
    name: 'top-artists-sync',
    schedule: '0 */12 * * *', // Every 12 hours at :00
    handler: async () => {
      await syncTopArtists();
    },
    runOnStart: false, // Full sync on start already covers this
  });
}
