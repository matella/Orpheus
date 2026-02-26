import type { FastifyInstance } from 'fastify';
import {
  getAllTimePreferences,
  getTimePreferences,
  resetTimePreferences,
} from '../../database/repositories/time-preferences.repo.js';
import { stateVectorManager } from '../../intelligence/state-vector.js';

/**
 * Context intelligence endpoints.
 *
 * GET  /              — all learned time-of-day preferences
 * GET  /current       — what the system would infer right now
 * DELETE /            — reset all learned preferences
 */
export async function contextRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/context
   * Get all learned time-of-day preferences.
   */
  fastify.get('/', async () => {
    const all = getAllTimePreferences();
    return {
      preferences: all.map((p) => ({
        bracket: p.hour_bracket,
        energy: p.avg_energy,
        valence: p.avg_valence,
        tempo: p.avg_tempo,
        familiarity: p.avg_familiarity,
        vocalness: p.avg_vocalness,
        aggressiveness: p.avg_aggressiveness,
        preferredGenres: p.preferred_genres,
        sampleCount: p.sample_count,
        updatedAt: p.updated_at,
      })),
    };
  });

  /**
   * GET /api/context/current
   * Get what the system would infer as the initial state right now.
   */
  fastify.get('/current', async () => {
    const state = stateVectorManager.inferInitialState();
    const bracket = state.context;
    const prefs = getTimePreferences(bracket);

    return {
      bracket,
      hasLearnedData: prefs !== null && prefs.sample_count >= 2,
      sampleCount: prefs?.sample_count ?? 0,
      inferredState: {
        energy: state.energy,
        valence: state.valence,
        tempo: state.tempo,
        genreCluster: state.genreCluster,
        familiarity: state.familiarity,
        vocalness: state.vocalness,
        aggressiveness: state.aggressiveness,
      },
    };
  });

  /**
   * DELETE /api/context
   * Reset all learned time preferences.
   */
  fastify.delete('/', async () => {
    resetTimePreferences();
    return { success: true, message: 'Time preferences reset' };
  });
}
