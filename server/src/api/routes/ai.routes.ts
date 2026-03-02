import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { isOllamaAvailable } from '../../ai/ollama.js';
import {
  isAiEnabled,
  analyzeSession,
  generateInsight,
  generateMonthlyRecap,
  inferContextViaAi,
} from '../../ai/service.js';
import { getAiSuggestions } from '../../database/repositories/ai-suggestion.repo.js';
import { getAllMonthlyRecaps, getMonthlyRecap, upsertMonthlyRecap } from '../../database/repositories/monthly-recap.repo.js';
import { getAiSettings } from '../../database/repositories/settings.repo.js';
import { getActiveSession, getSessionHistory } from '../../database/repositories/session.repo.js';
import { getTimePreferences } from '../../database/repositories/time-preferences.repo.js';
import {
  getSkipRate,
  getGenreDistribution,
  getTotalListeningTime,
  getDiscoveryRate,
  getTopTracks,
  getListeningHourDistribution,
  getDailyListeningStats,
} from '../../database/repositories/analytics.repo.js';

/**
 * AI integration endpoints.
 *
 * GET  /status       — AI system status
 * GET  /suggestions  — recent AI suggestions
 * POST /analyze      — manually trigger analysis
 * GET  /recaps       — monthly listening recaps
 * POST /recaps       — generate recap for a specific month
 * POST /infer        — AI context inference for session start
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
    const limit = Math.min(query.limit ? parseInt(query.limit, 10) || 20 : 20, 100);

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

  /**
   * GET /api/ai/recaps
   * Get all monthly recaps (most recent first).
   */
  fastify.get('/recaps', async () => {
    const recaps = getAllMonthlyRecaps();
    return {
      recaps: recaps.map((r) => ({
        year: r.year,
        month: r.month,
        recap: r.recap,
        stats: JSON.parse(r.stats),
        createdAt: r.created_at,
      })),
    };
  });

  /**
   * POST /api/ai/recaps
   * Generate (or regenerate) a monthly recap for a given year/month.
   */
  fastify.post('/recaps', async (request, reply) => {
    if (!isAiEnabled()) {
      return reply.status(400).send({ error: 'AI is not enabled' });
    }

    const body = request.body as { year?: number; month?: number } | null;
    const now = new Date();
    // Default to previous month
    const targetDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = body?.year ?? targetDate.getFullYear();
    const month = body?.month ?? (targetDate.getMonth() + 1);

    // Validate year/month ranges
    if (!Number.isInteger(year) || year < 2020 || year > now.getFullYear() + 1) {
      return reply.status(400).send({ error: `Invalid year: ${year}` });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return reply.status(400).send({ error: `Invalid month: ${month}` });
    }

    // Gather stats for the month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month
    const daysInMonth = endDate.getDate();

    const totalMs = getTotalListeningTime(daysInMonth);
    const totalHours = totalMs / 3600000;
    const skipRate = getSkipRate(daysInMonth);
    const discoveryRate = getDiscoveryRate(daysInMonth);
    const topGenres = getGenreDistribution(daysInMonth);
    const topTracksData = getTopTracks(daysInMonth, 10);
    const hourDist = getListeningHourDistribution(daysInMonth);
    const dailyStats = getDailyListeningStats(daysInMonth);

    // Compute aggregates
    const totalTracks = dailyStats.reduce((s, d) => s + d.trackCount, 0);
    const avgEnergy = dailyStats.length > 0
      ? dailyStats.reduce((s, d) => s + (d.avgEnergy ?? 0.5), 0) / dailyStats.length
      : 0.5;
    const avgValence = 0.5; // Not tracked per-day; use neutral

    // Peak hour
    const peakHour = hourDist.length > 0
      ? hourDist.reduce((max, h) => h.minutes > max.minutes ? h : max, hourDist[0]).hour
      : 20;

    // Top artists from top tracks
    const artistCounts = new Map<string, number>();
    for (const t of topTracksData) {
      artistCounts.set(t.artist, (artistCounts.get(t.artist) ?? 0) + t.playCount);
    }
    const topArtists = [...artistCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([artist, count]) => ({ artist, count }));

    // Session names
    const { sessions } = getSessionHistory(50, 0);
    const recentSessionNames = sessions
      .filter((s) => s.session_name)
      .map((s) => s.session_name as string)
      .slice(0, 10);

    const recapCtx = {
      year,
      month,
      totalHours,
      totalTracks,
      totalSessions: sessions.length,
      avgEnergy,
      avgValence,
      topGenres,
      topArtists,
      skipRate,
      discoveryRate,
      peakListeningHour: peakHour,
      sessionNames: recentSessionNames,
    };

    const result = await generateMonthlyRecap(recapCtx);
    if (!result) {
      return reply.status(500).send({ error: 'Failed to generate recap' });
    }

    // Persist
    const stats = {
      totalHours,
      totalTracks,
      totalSessions: sessions.length,
      avgEnergy,
      skipRate,
      discoveryRate,
      topGenres: topGenres.slice(0, 5),
      topArtists: topArtists.slice(0, 5),
      personality: result.personality,
    };

    upsertMonthlyRecap(year, month, result.recap, stats);

    return {
      year,
      month,
      recap: result.recap,
      highlights: result.highlights,
      personality: result.personality,
      stats,
    };
  });

  /**
   * POST /api/ai/infer
   * AI context inference: suggest initial state for a new session.
   */
  fastify.post('/infer', async (_request, reply) => {
    if (!isAiEnabled()) {
      return reply.status(400).send({ error: 'AI is not enabled' });
    }

    const now = new Date();
    const hour = now.getHours();
    const timeBracket =
      hour >= 6 && hour < 12 ? 'morning' :
      hour >= 12 && hour < 17 ? 'afternoon' :
      hour >= 17 && hour < 22 ? 'evening' : 'night';

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = days[now.getDay()];

    const prefs = getTimePreferences(timeBracket);
    const learnedPrefs = prefs ? {
      energy: prefs.avg_energy,
      valence: prefs.avg_valence,
      tempo: prefs.avg_tempo,
      familiarity: prefs.avg_familiarity,
      vocalness: prefs.avg_vocalness,
      aggressiveness: prefs.avg_aggressiveness,
      genres: prefs.preferred_genres,
      sampleCount: prefs.sample_count,
    } : null;

    // Recent sessions for mood context
    const { sessions } = getSessionHistory(5, 0);
    const recentSessionMoods = sessions
      .filter((s) => s.session_name)
      .map((s) => s.session_name as string);

    // Recent genres from genre distribution
    const genres = getGenreDistribution(7);
    const recentGenres = genres.slice(0, 5).map((g) => g.genre);

    const result = await inferContextViaAi({
      timeBracket,
      dayOfWeek,
      learnedPrefs,
      recentSessionMoods,
      recentGenres,
    });

    if (!result) {
      return reply.status(500).send({ error: 'AI inference failed' });
    }

    return {
      timeBracket,
      dayOfWeek,
      inference: result,
    };
  });
}
