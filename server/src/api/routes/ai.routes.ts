import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { isOllamaAvailable } from '../../ai/ollama.js';
import { isAiEnabled, analyzeSession, generateInsight } from '../../ai/service.js';
import { getAiSuggestions } from '../../database/repositories/ai-suggestion.repo.js';
import { getAiSettings } from '../../database/repositories/settings.repo.js';
import { getActiveSession } from '../../database/repositories/session.repo.js';

/**
 * AI integration endpoints.
 *
 * GET  /status      — AI system status
 * GET  /suggestions — recent AI suggestions
 * POST /analyze     — manually trigger analysis
 */
export async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/ai/status
   * Returns AI enabled state, Ollama reachability, and config.
   */
  fastify.get('/status', async () => {
    const settings = getAiSettings();
    const ollamaStatus = await isOllamaAvailable();

    return {
      enabled: isAiEnabled(),
      configEnabled: config.ai.enabled,
      settingEnabled: settings.aiEnabled,
      analysisInterval: settings.aiAnalysisInterval,
      model: config.ai.ollamaModel,
      ollamaHost: config.ai.ollamaHost,
      ollama: ollamaStatus,
    };
  });

  /**
   * GET /api/ai/suggestions
   * Get recent AI suggestions, optionally filtered by session.
   */
  fastify.get('/suggestions', async (request) => {
    const query = request.query as { sessionId?: string; limit?: string };
    const sessionId = query.sessionId ? parseInt(query.sessionId, 10) : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;

    const suggestions = getAiSuggestions(sessionId, limit);
    return { suggestions };
  });

  /**
   * POST /api/ai/analyze
   * Manually trigger AI analysis for the active session.
   */
  fastify.post('/analyze', async (_request, reply) => {
    if (!isAiEnabled()) {
      return reply.status(400).send({ error: 'AI is not enabled' });
    }

    const session = getActiveSession();
    if (!session) {
      return reply.status(400).send({ error: 'No active session' });
    }

    // Fire both analysis and insight in parallel
    const [weightResult, insightResult] = await Promise.all([
      analyzeSession(session.id),
      generateInsight(session.id),
    ]);

    return {
      sessionId: session.id,
      weights: weightResult,
      insight: insightResult,
    };
  });
}
