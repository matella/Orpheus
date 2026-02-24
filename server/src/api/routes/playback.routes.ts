import type { FastifyInstance } from 'fastify';
import { getTrackStats, getGenreDistribution } from '../../database/repositories/track.repo.js';
import { engine } from '../../playback/engine.js';
import { getPlayerState, getDevices, pause, resume } from '../../spotify/player.js';

export async function playbackRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/playback/current
   * Get current playback state including current and next track.
   */
  fastify.get('/current', async () => {
    const current = engine.getCurrentTrack();
    const next = engine.getNextTrack();
    const state = engine.getState();

    // Also get Spotify's reported progress
    let progressMs = 0;
    let isPlaying = false;
    try {
      const playerState = await getPlayerState();
      if (playerState) {
        progressMs = playerState.progressMs;
        isPlaying = playerState.isPlaying;
      }
    } catch {
      // Ignore — just use defaults
    }

    return {
      current,
      next,
      isPlaying,
      progressMs,
      engineStatus: state.status,
      sessionId: state.sessionId,
      trackCount: state.trackCount,
    };
  });

  /**
   * POST /api/playback/skip
   * Skip the current track.
   */
  fastify.post('/skip', async (_request, reply) => {
    if (!engine.isRunning()) {
      return reply.status(400).send({ error: 'ENGINE_NOT_RUNNING', message: 'Playback engine is not running' });
    }

    await engine.skip();
    return { success: true, current: engine.getCurrentTrack() };
  });

  /**
   * POST /api/playback/pause
   * Pause playback on Spotify.
   */
  fastify.post('/pause', async (_request, reply) => {
    try {
      await pause();
      return { success: true };
    } catch (err: any) {
      return reply.status(502).send({ error: 'SPOTIFY_ERROR', message: err.message });
    }
  });

  /**
   * POST /api/playback/resume
   * Resume playback on Spotify.
   */
  fastify.post('/resume', async (_request, reply) => {
    try {
      await resume();
      return { success: true };
    } catch (err: any) {
      return reply.status(502).send({ error: 'SPOTIFY_ERROR', message: err.message });
    }
  });

  /**
   * GET /api/playback/devices
   * List available Spotify devices.
   */
  fastify.get('/devices', async () => {
    const devices = await getDevices();
    return { devices };
  });

  /**
   * GET /api/playback/state
   * Get the engine's internal state.
   */
  fastify.get('/state', async () => {
    return engine.getState();
  });

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
      genreBreakdown: genres.slice(0, 20),
    };
  });
}
