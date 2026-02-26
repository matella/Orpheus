import type { FastifyInstance } from 'fastify';
import {
  loadSteeringControls,
  saveSteeringControls,
  recordSteeringSnapshot,
} from '../../intelligence/steering.js';
import { engine } from '../../playback/engine.js';
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
}
