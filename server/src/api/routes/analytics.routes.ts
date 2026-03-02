import type { FastifyInstance } from 'fastify';
import {
  getCacheValue,
  setCacheValue,
  getTotalListeningTime,
  getTotalTracksPlayed,
  getSkipRate,
  getCompletionRate,
  getDiscoveryRate,
  getGenreDistribution,
  getListeningHourDistribution,
  getTopTracks,
  getDailyListeningStats,
} from '../../database/repositories/analytics.repo.js';
import { computeListeningStats, type ListeningStatsData } from '../../database/repositories/listening-stats.repo.js';

interface OverviewData {
  totalListeningMs: number;
  totalListeningHours: number;
  totalTracksPlayed: number;
  skipRate: number;
  completionRate: number;
  discoveryRate: number;
  cached: boolean;
  computedAt: string;
}

/**
 * Analytics endpoints.
 *
 * GET  /overview     — cached overview stats
 * GET  /genres       — genre distribution
 * GET  /energy       — daily energy trend
 * GET  /hours        — listening minutes by hour of day
 * GET  /top-tracks   — top tracks by play count
 * GET  /daily        — per-day listening stats
 */
export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/analytics/overview
   * Cached overview stats (lazy-computed on miss).
   */
  fastify.get('/overview', async () => {
    const cached = getCacheValue<OverviewData>('analytics:overview');
    if (cached) return cached;

    const totalListeningMs = getTotalListeningTime(30);
    const tracksPlayed = getTotalTracksPlayed(30);
    const skipRate = getSkipRate(7);
    const completionRate = getCompletionRate(7);
    const discoveryRate = getDiscoveryRate(30);

    const overview: OverviewData = {
      totalListeningMs,
      totalListeningHours: Math.round((totalListeningMs / 3600000) * 10) / 10,
      totalTracksPlayed: tracksPlayed,
      skipRate,
      completionRate,
      discoveryRate,
      cached: false,
      computedAt: new Date().toISOString(),
    };

    setCacheValue('analytics:overview', overview, 24);
    return overview;
  });

  /**
   * GET /api/analytics/genres
   * Genre distribution with percentages.
   */
  fastify.get('/genres', async (request) => {
    const query = request.query as { days?: string };
    const days = parseInt(query.days ?? '30', 10) || 30;

    const genres = getGenreDistribution(days);
    const totalCount = genres.reduce((sum, g) => sum + g.count, 0);

    return {
      genres: genres.map((g) => ({
        genre: g.genre,
        count: g.count,
        percentage: totalCount === 0 ? 0 : Math.round((g.count / totalCount) * 1000) / 10,
      })),
    };
  });

  /**
   * GET /api/analytics/energy
   * Daily average energy trend.
   */
  fastify.get('/energy', async (request) => {
    const query = request.query as { days?: string };
    const days = parseInt(query.days ?? '30', 10) || 30;

    const daily = getDailyListeningStats(days);
    return {
      trend: daily.map((d) => ({
        date: d.date,
        avgEnergy: d.avgEnergy,
      })),
    };
  });

  /**
   * GET /api/analytics/hours
   * Listening minutes by hour of day (0-23), padded to all 24 hours.
   */
  fastify.get('/hours', async (request) => {
    const query = request.query as { days?: string };
    const days = parseInt(query.days ?? '30', 10) || 30;

    const raw = getListeningHourDistribution(days);
    const byHour = new Map(raw.map((r) => [r.hour, r.minutes]));

    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      minutes: byHour.get(hour) ?? 0,
    }));

    return { hours };
  });

  /**
   * GET /api/analytics/top-tracks
   * Top tracks by play count.
   */
  fastify.get('/top-tracks', async (request) => {
    const query = request.query as { days?: string; limit?: string };
    const days = parseInt(query.days ?? '30', 10) || 30;
    const limit = Math.min(parseInt(query.limit ?? '20', 10) || 20, 50);

    const tracks = getTopTracks(days, limit);
    return { tracks };
  });

  /**
   * GET /api/analytics/daily
   * Per-day listening stats for sparklines.
   */
  fastify.get('/daily', async (request) => {
    const query = request.query as { days?: string };
    const days = parseInt(query.days ?? '30', 10) || 30;

    const daily = getDailyListeningStats(days);
    return { daily };
  });

  /**
   * GET /api/analytics/listening-stats
   * Comprehensive listening stats combining Orpheus + Spotify data.
   */
  fastify.get('/listening-stats', async (request) => {
    const query = request.query as { days?: string };
    const days = parseInt(query.days ?? '30', 10) || 30;

    // Try cache first (cache key includes days param to avoid stale cross-window results)
    const cacheKey = `analytics:listening_stats:${days}`;
    const cached = getCacheValue<ListeningStatsData>(cacheKey);
    if (cached) return { ...cached, cached: true };

    // Compute on demand
    const stats = computeListeningStats(days);
    setCacheValue(cacheKey, stats, 24);
    return { ...stats, cached: false };
  });
}
