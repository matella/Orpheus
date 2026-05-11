import type { FastifyInstance } from 'fastify';
import {
  getDjPreferences,
  updateDjPreferences,
  markOnboardingComplete,
  type Persona,
  type Chattiness,
  type DiscoveryAppetite,
} from '../../database/repositories/dj-preferences.repo.js';
import { logger } from '../../shared/logger.js';

const VALID_PERSONAS: Persona[] = ['curator', 'late_night', 'hype', 'chill', 'custom'];
const VALID_CHATTINESS: Chattiness[] = ['silent', 'minimal', 'balanced', 'chatty'];
const VALID_APPETITE: DiscoveryAppetite[] = ['comfort', 'balanced', 'adventurous'];

export async function djRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/dj/preferences
   * Return current DJ preferences.
   */
  fastify.get('/preferences', async () => {
    return getDjPreferences();
  });

  /**
   * PUT /api/dj/preferences
   * Partial update of DJ preferences.
   */
  fastify.put('/preferences', async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    const patch: Parameters<typeof updateDjPreferences>[0] = {};

    if ('persona' in body) {
      if (!VALID_PERSONAS.includes(body.persona as Persona)) {
        return reply.status(400).send({ error: `persona must be one of: ${VALID_PERSONAS.join(', ')}` });
      }
      patch.persona = body.persona as Persona;
    }

    if ('customPersona' in body) {
      const cp = body.customPersona;
      if (cp !== null && (typeof cp !== 'string' || cp.length > 500)) {
        return reply.status(400).send({ error: 'customPersona must be null or a string under 500 chars' });
      }
      patch.customPersona = (cp as string | null);
    }

    if ('chattiness' in body) {
      if (!VALID_CHATTINESS.includes(body.chattiness as Chattiness)) {
        return reply.status(400).send({ error: `chattiness must be one of: ${VALID_CHATTINESS.join(', ')}` });
      }
      patch.chattiness = body.chattiness as Chattiness;
    }

    if ('discoveryAppetite' in body) {
      if (!VALID_APPETITE.includes(body.discoveryAppetite as DiscoveryAppetite)) {
        return reply.status(400).send({ error: `discoveryAppetite must be one of: ${VALID_APPETITE.join(', ')}` });
      }
      patch.discoveryAppetite = body.discoveryAppetite as DiscoveryAppetite;
    }

    const updated = updateDjPreferences(patch);
    logger.info({ patch }, 'DJ preferences updated');
    return updated;
  });

  /**
   * GET /api/dj/onboarding
   * Return onboarding status.
   */
  fastify.get('/onboarding', async () => {
    const prefs = getDjPreferences();
    return { completed: prefs.onboardingCompleted };
  });

  /**
   * POST /api/dj/onboarding/complete
   * Mark onboarding as done.
   */
  fastify.post('/onboarding/complete', async () => {
    markOnboardingComplete();
    logger.info('DJ onboarding marked complete');
    return { success: true };
  });
}
