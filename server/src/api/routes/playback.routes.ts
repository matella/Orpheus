import type { FastifyInstance } from 'fastify';
import { getTrackStats, getGenreDistribution, markTracksWithDefaultFeatures } from '../../database/repositories/track.repo.js';
import { engine } from '../../playback/engine.js';
import { getPlayerState, getDevices, pause, resume, skipToPrevious } from '../../spotify/player.js';
import { fullLibrarySync } from '../../spotify/library.js';
import { handleMusicRequest } from '../../intelligence/request-handler.js';
import { toPlaybackTrack } from '../../playback/types.js';
import { broadcast } from '../websocket.js';
import { logger } from '../../shared/logger.js';

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
   * POST /api/playback/previous
   * Go to the previous track on Spotify.
   */
  fastify.post('/previous', async (_request, reply) => {
    try {
      await skipToPrevious();
      return { success: true };
    } catch (err: any) {
      return reply.status(502).send({ error: 'SPOTIFY_ERROR', message: err.message });
    }
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
   * POST /api/playback/start
   * Manually start the engine on a specific device.
   * Body: { deviceId?: string, deviceName?: string }
   * If no deviceId is provided, uses the first active Spotify device.
   */
  fastify.post('/start', async (request, reply) => {
    if (engine.isRunning()) {
      return reply.status(400).send({
        error: 'ENGINE_ALREADY_RUNNING',
        message: 'Playback engine is already running',
      });
    }

    // Check library has tracks before attempting to start
    let stats = getTrackStats();
    if (stats.withFeatures === 0) {
      if (stats.total === 0) {
        return reply.status(400).send({
          error: 'EMPTY_LIBRARY',
          message: 'No tracks in library. Save some tracks on Spotify, then use Sync Library.',
        });
      }

      // Tracks exist but audio features missing — Spotify likely blocks the
      // audio-features endpoint for this app. Mark with neutral defaults so
      // the engine can function.
      const marked = markTracksWithDefaultFeatures();
      logger.info({ marked }, 'Marked tracks with default audio features for engine start');
      stats = getTrackStats();

      if (stats.withFeatures === 0) {
        return reply.status(400).send({
          error: 'EMPTY_LIBRARY',
          message: 'Failed to prepare tracks for playback. Check server logs.',
        });
      }
    }

    const body = (request.body as { deviceId?: string; deviceName?: string }) ?? {};

    if (!body.deviceId) {
      const devices = await getDevices();
      const active = devices.find((d) => d.isActive);
      if (!active) {
        return reply.status(400).send({
          error: 'NO_DEVICE',
          message: 'No active Spotify device found. Open Spotify on a device first.',
        });
      }
      await engine.start(active.id, active.name, false);
    } else {
      await engine.start(body.deviceId, body.deviceName, false);
    }

    // Engine may have stopped itself if playback failed
    if (!engine.isRunning()) {
      return reply.status(500).send({
        error: 'ENGINE_START_FAILED',
        message: 'Engine started but failed immediately. Check server logs for details.',
      });
    }

    return { success: true, state: engine.getState() };
  });

  /**
   * POST /api/playback/stop
   * Manually stop the engine and end the session.
   */
  fastify.post('/stop', async (_request, reply) => {
    if (!engine.isRunning()) {
      return reply.status(400).send({
        error: 'ENGINE_NOT_RUNNING',
        message: 'Playback engine is not running',
      });
    }

    engine.stop();
    return { success: true };
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

  /**
   * POST /api/playback/library/sync
   * Manually trigger a full library sync.
   */
  fastify.post('/library/sync', async () => {
    const result = await fullLibrarySync();
    const stats = getTrackStats();
    return {
      success: true,
      synced: result,
      library: {
        total: stats.total,
        withFeatures: stats.withFeatures,
      },
    };
  });

  /**
   * POST /api/playback/request
   * Process a natural language music request and inject matching tracks into the queue.
   * Body: { prompt: string }
   */
  fastify.post('/request', async (request, reply) => {
    const body = request.body as { prompt?: string } | null;
    const prompt = body?.prompt?.trim();

    if (!prompt || prompt.length === 0) {
      return reply.status(400).send({
        error: 'MISSING_PROMPT',
        message: 'A text prompt is required',
      });
    }

    if (prompt.length > 500) {
      return reply.status(400).send({
        error: 'PROMPT_TOO_LONG',
        message: 'Prompt must be under 500 characters',
      });
    }

    try {
      const result = await handleMusicRequest(prompt);
      const { tracks, parsed, source } = result;

      if (tracks.length === 0) {
        return {
          success: true,
          injected: 0,
          tracks: [],
          message: 'No matching tracks found. Try a different request.',
          parsed,
          source,
        };
      }

      // If engine is running, inject into queue
      let injected = 0;
      if (engine.isRunning()) {
        const playbackTracks = tracks.map(toPlaybackTrack);
        const injectResult = await engine.injectTracks(playbackTracks);
        injected = injectResult.injected;
      }

      const trackSummaries = tracks.map((t) => ({
        id: t.id,
        name: t.name,
        artist: t.artist,
        album: t.album,
        albumArtUrl: t.album_art_url,
      }));

      // Broadcast to WebSocket clients (include lock flags if prompt triggered a lock)
      broadcast({
        type: 'request_fulfilled',
        data: {
          prompt,
          injected,
          tracks: trackSummaries,
          genreLocked: result.genreLocked ?? null,
          artistLocked: result.artistLocked ?? null,
        },
      });

      // Broadcast explicit lock events so all clients update their lock chips
      if (result.genreLocked) {
        broadcast({ type: 'genre_lock_changed', data: { genre: result.genreLocked, locked: true } });
      }
      if (result.artistLocked) {
        broadcast({ type: 'artist_lock_changed', data: { artist: result.artistLocked, locked: true } });
      }

      return {
        success: true,
        injected,
        tracks: trackSummaries,
        message: injected > 0
          ? `Queued ${injected} tracks`
          : 'Tracks found but engine is not running. Start the engine first.',
        parsed,
        source,
      };
    } catch (err) {
      logger.error({ err, prompt }, 'Music request handler failed');
      return reply.status(500).send({
        error: 'REQUEST_FAILED',
        message: 'Failed to process music request',
      });
    }
  });
}
