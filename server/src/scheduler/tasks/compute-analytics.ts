import { registerTask } from '../scheduler.js';
import {
  setCacheValue,
  cleanExpiredCache,
  getTotalListeningTime,
  getSkipRate,
  getCompletionRate,
  getDiscoveryRate,
} from '../../database/repositories/analytics.repo.js';
import { getTrackStats } from '../../database/repositories/track.repo.js';
import { logger } from '../../shared/logger.js';

/**
 * Register the daily analytics precomputation task.
 * Runs at midnight to refresh the analytics cache.
 */
export function registerAnalyticsComputeTask(): void {
  registerTask({
    name: 'compute-analytics',
    schedule: '0 0 * * *', // Midnight daily
    handler: async () => {
      logger.info('Computing analytics cache...');

      const totalListeningMs = getTotalListeningTime(30);
      const stats = getTrackStats();
      const skipRate = getSkipRate(7);
      const completionRate = getCompletionRate(7);
      const discoveryRate = getDiscoveryRate(30);

      const overview = {
        totalListeningMs,
        totalListeningHours: Math.round((totalListeningMs / 3600000) * 10) / 10,
        totalTracksPlayed: stats.total,
        skipRate,
        completionRate,
        discoveryRate,
        cached: true,
        computedAt: new Date().toISOString(),
      };

      setCacheValue('analytics:overview', overview, 24);

      // Clean up expired cache entries
      const cleaned = cleanExpiredCache();
      if (cleaned > 0) {
        logger.info({ cleaned }, 'Cleaned expired analytics cache entries');
      }

      logger.info('Analytics cache updated');
    },
    runOnStart: false,
  });
}
