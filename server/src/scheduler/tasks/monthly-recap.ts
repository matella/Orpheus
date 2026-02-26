import { registerTask } from '../scheduler.js';
import { isAiEnabled, generateMonthlyRecap } from '../../ai/service.js';
import { getMonthlyRecap, upsertMonthlyRecap } from '../../database/repositories/monthly-recap.repo.js';
import { getSessionHistory } from '../../database/repositories/session.repo.js';
import {
  getTotalListeningTime,
  getSkipRate,
  getDiscoveryRate,
  getGenreDistribution,
  getTopTracks,
  getListeningHourDistribution,
  getDailyListeningStats,
} from '../../database/repositories/analytics.repo.js';
import { logger } from '../../shared/logger.js';

/**
 * Register the monthly recap generation task.
 * Runs on the 1st of each month at 06:00 to recap the previous month.
 */
export function registerMonthlyRecapTask(): void {
  registerTask({
    name: 'monthly-recap',
    schedule: '0 6 1 * *', // 6 AM on the 1st of each month
    handler: async () => {
      if (!isAiEnabled()) {
        logger.debug('AI not enabled, skipping monthly recap');
        return;
      }

      // Target the previous month
      const now = new Date();
      const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const year = target.getFullYear();
      const month = target.getMonth() + 1;

      // Skip if already generated
      const existing = getMonthlyRecap(year, month);
      if (existing) {
        logger.debug({ year, month }, 'Monthly recap already exists');
        return;
      }

      logger.info({ year, month }, 'Generating monthly recap...');

      const daysInMonth = new Date(year, month, 0).getDate();
      const totalMs = getTotalListeningTime(daysInMonth);
      const totalHours = totalMs / 3600000;

      // Skip if minimal listening
      if (totalHours < 1) {
        logger.debug({ year, month, hours: totalHours }, 'Too little listening data for recap');
        return;
      }

      const skipRate = getSkipRate(daysInMonth);
      const discoveryRate = getDiscoveryRate(daysInMonth);
      const topGenres = getGenreDistribution(daysInMonth);
      const topTracksData = getTopTracks(daysInMonth, 10);
      const hourDist = getListeningHourDistribution(daysInMonth);
      const dailyStats = getDailyListeningStats(daysInMonth);

      const totalTracks = dailyStats.reduce((s, d) => s + d.trackCount, 0);
      const avgEnergy = dailyStats.length > 0
        ? dailyStats.reduce((s, d) => s + (d.avgEnergy ?? 0.5), 0) / dailyStats.length
        : 0.5;

      const peakHour = hourDist.length > 0
        ? hourDist.reduce((max, h) => h.minutes > max.minutes ? h : max, hourDist[0]).hour
        : 20;

      const artistCounts = new Map<string, number>();
      for (const t of topTracksData) {
        artistCounts.set(t.artist, (artistCounts.get(t.artist) ?? 0) + t.playCount);
      }
      const topArtists = [...artistCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([artist, count]) => ({ artist, count }));

      const { sessions } = getSessionHistory(50, 0);
      const recentSessionNames = sessions
        .filter((s) => s.session_name)
        .map((s) => s.session_name as string)
        .slice(0, 10);

      const result = await generateMonthlyRecap({
        year,
        month,
        totalHours,
        totalTracks,
        totalSessions: sessions.length,
        avgEnergy,
        avgValence: 0.5,
        topGenres,
        topArtists,
        skipRate,
        discoveryRate,
        peakListeningHour: peakHour,
        sessionNames: recentSessionNames,
      });

      if (!result) {
        logger.warn({ year, month }, 'Failed to generate monthly recap');
        return;
      }

      const stats = {
        totalHours,
        totalTracks,
        totalSessions: sessions.length,
        avgEnergy,
        skipRate,
        discoveryRate,
        topGenres: topGenres.slice(0, 5),
        topArtists: topArtists.slice(0, 5),
        personality: result.personality,
      };

      upsertMonthlyRecap(year, month, result.recap, stats);
      logger.info({ year, month, personality: result.personality }, 'Monthly recap generated');
    },
    runOnStart: false,
  });
}
