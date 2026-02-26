import type { FastifyInstance } from 'fastify';
import { getSessionHistory, getActiveSession, getSessionById } from '../../database/repositories/session.repo.js';
import { getEnergyCurve, getStateHistory } from '../../database/repositories/state-history.repo.js';
import { getSessionInteractionsWithTracks } from '../../database/repositories/analytics.repo.js';
import type { SessionRow } from '../../database/types.js';

function formatSession(row: SessionRow) {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    deviceName: row.device_name,
    trackCount: row.track_count,
    totalDurationMs: row.total_duration_ms,
    avgEnergy: row.avg_energy,
    avgValence: row.avg_valence,
    initialContext: row.initial_context,
    autoStarted: row.auto_started === 1,
    sessionName: row.session_name,
  };
}

/**
 * Session endpoints.
 *
 * GET  /             — paginated session list with energy curves
 * GET  /active       — active session detail with tracks + state history
 * GET  /:id          — session detail by ID
 */
export async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/sessions
   * Paginated session list with mini energy curves for sparklines.
   */
  fastify.get('/', async (request) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit ?? '20', 10) || 20, 50);
    const offset = parseInt(query.offset ?? '0', 10) || 0;

    const { sessions, total } = getSessionHistory(limit, offset);

    return {
      sessions: sessions.map((s) => ({
        ...formatSession(s),
        energyCurve: getEnergyCurve(s.id),
      })),
      total,
    };
  });

  /**
   * GET /api/sessions/active
   * Active session with full track list and state history.
   */
  fastify.get('/active', async () => {
    const session = getActiveSession();
    if (!session) {
      return { session: null, tracks: [], stateHistory: [] };
    }

    const tracks = getSessionInteractionsWithTracks(session.id);
    const history = getStateHistory(session.id);

    return {
      session: formatSession(session),
      tracks,
      stateHistory: history.map((h) => ({
        energy: h.energy,
        valence: h.valence,
        tempo: h.tempo,
        genreCluster: h.genre_cluster,
        fatigueLevel: h.fatigue_level,
        recordedAt: h.recorded_at,
      })),
    };
  });

  /**
   * GET /api/sessions/:id
   * Session detail by ID with tracks and state history.
   */
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const sessionId = parseInt(id, 10);

    if (isNaN(sessionId)) {
      return reply.status(400).send({ error: 'INVALID_ID', message: 'Session ID must be a number' });
    }

    const session = getSessionById(sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'SESSION_NOT_FOUND', message: 'Session not found' });
    }

    const tracks = getSessionInteractionsWithTracks(session.id);
    const history = getStateHistory(session.id);

    return {
      session: formatSession(session),
      tracks,
      stateHistory: history.map((h) => ({
        energy: h.energy,
        valence: h.valence,
        tempo: h.tempo,
        genreCluster: h.genre_cluster,
        fatigueLevel: h.fatigue_level,
        recordedAt: h.recorded_at,
      })),
    };
  });
}
