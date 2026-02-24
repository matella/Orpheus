import type { FastifyInstance } from 'fastify';
import { getTrackStats, getGenreDistribution } from '../../database/repositories/track.repo.js';

export async function playbackRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/playback/library/stats
   * Get library cache statistics.
   */
  fastify.get('/library/stats', async () => {
    const stats = getTrackStats();
    const genres = getGenreDistribution();

    return {
      trackCount: stats.total,
      tracksWithFeatures: stats.withFeatures,
      bySource: stats.bySource,
      genreBreakdown: genres.slice(0, 20), // Top 20 genres
    };
  });
}
