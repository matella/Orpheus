import type { FastifyInstance } from 'fastify';
import { engine } from '../../playback/engine.js';
import { recordInteraction } from '../../database/repositories/interaction.repo.js';
import { selector } from '../../intelligence/selector.js';
import { logger } from '../../shared/logger.js';

export async function feedbackRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/feedback/like
   * Record a like for the current (or specified) track.
   */
  fastify.post<{ Body?: { trackId?: number } }>('/like', async (_request, reply) => {
    const trackId = _request.body?.trackId ?? engine.getCurrentTrack()?.id;
    if (!trackId) {
      return reply.status(400).send({
        error: 'NO_TRACK',
        message: 'No track to like. Is the engine running?',
      });
    }

    const sessionId = engine.getState().sessionId ?? undefined;

    recordInteraction({
      trackId,
      sessionId,
      interactionType: 'like',
    });

    selector.onInteraction({
      track_id: trackId,
      interaction_type: 'like',
    });

    logger.info({ trackId }, 'Track liked');
    return { success: true, trackId };
  });

  /**
   * POST /api/feedback/dislike
   * Record a dislike for the current (or specified) track.
   */
  fastify.post<{ Body?: { trackId?: number } }>('/dislike', async (_request, reply) => {
    const trackId = _request.body?.trackId ?? engine.getCurrentTrack()?.id;
    if (!trackId) {
      return reply.status(400).send({
        error: 'NO_TRACK',
        message: 'No track to dislike. Is the engine running?',
      });
    }

    const sessionId = engine.getState().sessionId ?? undefined;

    recordInteraction({
      trackId,
      sessionId,
      interactionType: 'dislike',
    });

    selector.onInteraction({
      track_id: trackId,
      interaction_type: 'dislike',
    });

    logger.info({ trackId }, 'Track disliked');
    return { success: true, trackId };
  });
}
