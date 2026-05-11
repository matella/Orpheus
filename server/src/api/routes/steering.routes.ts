import type { FastifyInstance } from 'fastify';
import {
  loadSteeringControls,
  saveSteeringControls,
  recordSteeringSnapshot,
} from '../../intelligence/steering.js';
import { engine } from '../../playback/engine.js';
import { selector } from '../../intelligence/selector.js';
import type { SteeringControls } from '../../intelligence/types.js';
import { STEERING_KEYS } from '../../intelligence/types.js';
import { broadcast } from '../websocket.js';

/**
 * Steering control endpoints.
 *
 * GET  / — returns current steering controls (7 axes, each 0-1)
 * PUT  / — update steering controls (partial update supported)
 */
export async function steeringRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/steering
   * Get current steering controls.
   */
  fastify.get('/', async () => {
    return loadSteeringControls();
  });

  /**
   * PUT /api/steering
   * Update steering controls. Accepts a partial update — only provided
   * keys are changed, others remain at their current values.
   * Values are clamped to [0, 1].
   */
  fastify.put('/', async (request) => {
    const body = request.body as Partial<SteeringControls>;

    // Load current, merge with update, clamp values to [0, 1]
    const current = loadSteeringControls();
    for (const key of STEERING_KEYS) {
      const val = (body as Record<string, unknown>)[key];
      if (typeof val === 'number') {
        current[key] = Math.max(0, Math.min(1, val));
      }
    }

    saveSteeringControls(current);

    // Record snapshot if a session is active
    const state = engine.getState();
    if (state.sessionId) {
      recordSteeringSnapshot(state.sessionId, current);
    }

    // Broadcast update to all WebSocket clients
    broadcast({ type: 'steering_updated', data: current });

    return { success: true };
  });

  /**
   * GET /api/steering/target-genre
   * Get the current session-scoped target genre (set by music requests).
   */
  fastify.get('/target-genre', async () => {
    return { targetGenre: selector.getTargetGenre() };
  });

  /**
   * PUT /api/steering/target-genre
   * Lock track selection to a specific genre.
   * Body: { genre: string }
   */
  fastify.put('/target-genre', async (request, reply) => {
    const body = request.body as { genre?: string } | null;
    const genre = body?.genre?.trim();

    if (!genre || genre.length === 0) {
      return reply.status(400).send({ error: 'MISSING_GENRE', message: 'A genre string is required' });
    }

    selector.setTargetGenre(genre);
    broadcast({ type: 'genre_lock_changed', data: { genre, locked: true } });
    return { success: true, targetGenre: genre };
  });

  /**
   * DELETE /api/steering/target-genre
   * Clear the target genre, returning the AI to its natural genre selection.
   */
  fastify.delete('/target-genre', async () => {
    selector.setTargetGenre(null);
    broadcast({ type: 'genre_lock_changed', data: { genre: null, locked: false } });
    return { success: true };
  });

  /**
   * GET /api/steering/target-artist
   * Get the current session-scoped target artist.
   */
  fastify.get('/target-artist', async () => {
    return { targetArtist: selector.getTargetArtist() };
  });

  /**
   * PUT /api/steering/target-artist
   * Lock track selection to a specific artist.
   * Body: { artist: string }
   */
  fastify.put('/target-artist', async (request, reply) => {
    const body = request.body as { artist?: string } | null;
    const artist = body?.artist?.trim();

    if (!artist || artist.length === 0) {
      return reply.status(400).send({ error: 'MISSING_ARTIST', message: 'An artist name is required' });
    }

    selector.setTargetArtist(artist);
    broadcast({ type: 'artist_lock_changed', data: { artist, locked: true } });
    return { success: true, targetArtist: artist };
  });

  /**
   * DELETE /api/steering/target-artist
   * Clear the target artist lock.
   */
  fastify.delete('/target-artist', async () => {
    selector.setTargetArtist(null);
    broadcast({ type: 'artist_lock_changed', data: { artist: null, locked: false } });
    return { success: true };
  });
}
