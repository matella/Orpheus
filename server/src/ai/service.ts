import { config } from '../config.js';
import { logger } from '../shared/logger.js';
import {
  AI_WEIGHT_MULTIPLIER_MIN,
  AI_WEIGHT_MULTIPLIER_MAX,
  AI_MAX_CONTEXT_HISTORY,
  AI_INSIGHT_MIN_TRACKS,
} from '../shared/constants.js';
import { getAiSettings } from '../database/repositories/settings.repo.js';
import { getStateHistory } from '../database/repositories/state-history.repo.js';
import { getSessionInteractions } from '../database/repositories/interaction.repo.js';
import { getSessionById } from '../database/repositories/session.repo.js';
import { insertAiSuggestion } from '../database/repositories/ai-suggestion.repo.js';
import { loadSteeringControls } from '../intelligence/steering.js';
import { stateVectorManager } from '../intelligence/state-vector.js';
import { broadcast } from '../api/websocket.js';
import { generate, generateJson } from './ollama.js';
import {
  buildWeightSuggestionPrompt,
  buildSessionNamePrompt,
  buildInsightPrompt,
  type WeightSuggestion,
  type SessionNameSuggestion,
  type InsightSuggestion,
  type SessionContext,
} from './prompts.js';

// ── In-Memory Cache ────────────────────────────────────────────────

/** Synchronous cache for scorer to read without awaiting. */
const weightSuggestionCache = new Map<number, WeightSuggestion>();

/**
 * Read the current AI weight suggestion for a session.
 * Returns null if no suggestion is cached.
 */
export function getActiveWeightSuggestion(sessionId: number): WeightSuggestion | null {
  return weightSuggestionCache.get(sessionId) ?? null;
}

/**
 * Clear cached suggestion when a session ends.
 */
export function clearSessionSuggestion(sessionId: number): void {
  weightSuggestionCache.delete(sessionId);
}

// ── AI Enabled Check ───────────────────────────────────────────────

/**
 * Check if AI is enabled (both config + DB setting).
 */
export function isAiEnabled(): boolean {
  if (!config.ai.enabled) return false;
  const settings = getAiSettings();
  return settings.aiEnabled;
}

// ── Context Gathering ──────────────────────────────────────────────

function gatherSessionContext(sessionId: number): SessionContext | null {
  const session = getSessionById(sessionId);
  if (!session) return null;

  const stateHistory = getStateHistory(sessionId);
  const interactions = getSessionInteractions(sessionId);

  let currentState;
  try {
    currentState = stateVectorManager.getState(sessionId);
  } catch {
    // Session state not initialized — use last history entry or defaults
    const last = stateHistory[stateHistory.length - 1];
    if (!last) return null;
    currentState = {
      energy: last.energy ?? 0.5,
      valence: last.valence ?? 0.5,
      tempo: last.tempo ?? 120,
      genreCluster: last.genre_cluster,
      familiarity: last.familiarity ?? 0.5,
      vocalness: last.vocalness ?? 0.5,
      aggressiveness: last.aggressiveness ?? 0.3,
      context: last.context ?? 'unknown',
      fatigueLevel: last.fatigue_level ?? 0,
    };
  }

  const steering = loadSteeringControls();

  // Compute skip rate from interactions
  const playSkipInteractions = interactions.filter(
    (i) => i.interaction_type === 'play' || i.interaction_type === 'skip',
  );
  const skipCount = playSkipInteractions.filter((i) => i.interaction_type === 'skip').length;
  const skipRate = playSkipInteractions.length > 0 ? skipCount / playSkipInteractions.length : 0;

  // Dominant genres from state trajectory
  const genreCounts = new Map<string, number>();
  for (const entry of stateHistory) {
    if (entry.genre_cluster) {
      genreCounts.set(entry.genre_cluster, (genreCounts.get(entry.genre_cluster) ?? 0) + 1);
    }
  }
  const dominantGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([genre]) => genre);

  // State trajectory (limited)
  const stateTrajectory = stateHistory.slice(-AI_MAX_CONTEXT_HISTORY).map((s) => ({
    energy: s.energy ?? 0.5,
    valence: s.valence ?? 0.5,
    tempo: s.tempo ?? 120,
    genreCluster: s.genre_cluster,
  }));

  // Recent interactions with track info — we only have track_id, so use what we have
  const recentInteractions = interactions.slice(-10).map((i) => ({
    trackName: `Track #${i.track_id}`,
    artist: 'Unknown',
    interactionType: i.interaction_type,
    completionRatio: i.completion_ratio,
  }));

  return {
    sessionId,
    trackCount: session.track_count,
    stateTrajectory,
    currentState,
    steering,
    recentInteractions,
    skipRate,
    dominantGenres,
  };
}

// ── Core AI Functions ──────────────────────────────────────────────

/**
 * Analyze a session and generate weight suggestions.
 * Caches the result for synchronous reads by the scorer.
 */
export async function analyzeSession(sessionId: number): Promise<WeightSuggestion | null> {
  if (!isAiEnabled()) return null;

  try {
    const ctx = gatherSessionContext(sessionId);
    if (!ctx || ctx.trackCount < AI_INSIGHT_MIN_TRACKS) return null;

    const prompt = buildWeightSuggestionPrompt(ctx);
    const result = await generateJson<WeightSuggestion>(prompt);

    if (!result) return null;

    // Validate and clamp all weight multipliers
    const weightKeys = [
      'stateSimilarity', 'preference', 'novelty', 'transition',
      'fatigue', 'context', 'recency',
    ] as const;

    for (const key of weightKeys) {
      const val = result[key];
      if (typeof val !== 'number' || isNaN(val)) {
        result[key] = 1.0;
      } else {
        result[key] = Math.max(AI_WEIGHT_MULTIPLIER_MIN, Math.min(AI_WEIGHT_MULTIPLIER_MAX, val));
      }
    }

    if (typeof result.reasoning !== 'string') {
      result.reasoning = '';
    }

    // Cache for synchronous reads
    weightSuggestionCache.set(sessionId, result);

    // Persist to database
    insertAiSuggestion({
      sessionId,
      suggestionType: 'weight',
      prompt,
      response: JSON.stringify(result),
      applied: true,
    });

    logger.info(
      { sessionId, suggestion: result },
      'AI weight suggestion generated and cached',
    );

    return result;
  } catch (err) {
    logger.warn({ err, sessionId }, 'AI session analysis failed');
    return null;
  }
}

/**
 * Generate a creative name for a session.
 * Persists directly to the session name column via ai_suggestions.
 */
export async function generateSessionName(sessionId: number): Promise<string | null> {
  if (!isAiEnabled()) return null;

  try {
    const session = getSessionById(sessionId);
    if (!session) return null;

    const stateHistory = getStateHistory(sessionId);
    if (stateHistory.length === 0) return null;

    // Compute summary
    const avgEnergy =
      stateHistory.reduce((sum, s) => sum + (s.energy ?? 0.5), 0) / stateHistory.length;
    const avgValence =
      stateHistory.reduce((sum, s) => sum + (s.valence ?? 0.5), 0) / stateHistory.length;

    const genreCounts = new Map<string, number>();
    for (const entry of stateHistory) {
      if (entry.genre_cluster) {
        genreCounts.set(entry.genre_cluster, (genreCounts.get(entry.genre_cluster) ?? 0) + 1);
      }
    }
    const dominantGenres = [...genreCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([genre]) => genre);

    const startedAt = new Date(session.started_at);
    const hour = startedAt.getHours();
    const timeOfDay =
      hour >= 6 && hour < 12 ? 'morning' :
      hour >= 12 && hour < 17 ? 'afternoon' :
      hour >= 17 && hour < 22 ? 'evening' : 'night';

    const durationMinutes = session.total_duration_ms
      ? Math.round(session.total_duration_ms / 60000)
      : stateHistory.length * 3; // Rough estimate

    const prompt = buildSessionNamePrompt({
      trackCount: session.track_count,
      avgEnergy,
      avgValence,
      dominantGenres,
      timeOfDay,
      durationMinutes,
    });

    const result = await generateJson<SessionNameSuggestion>(prompt);

    if (!result?.name || typeof result.name !== 'string') return null;

    // Clean up: trim and limit length
    const name = result.name.trim().slice(0, 60);

    // Persist
    insertAiSuggestion({
      sessionId,
      suggestionType: 'name',
      prompt,
      response: JSON.stringify({ name }),
    });

    logger.info({ sessionId, name }, 'AI session name generated');
    return name;
  } catch (err) {
    logger.warn({ err, sessionId }, 'AI session name generation failed');
    return null;
  }
}

/**
 * Generate a listening insight and broadcast it to clients.
 */
export async function generateInsight(sessionId: number): Promise<string | null> {
  if (!isAiEnabled()) return null;

  try {
    const ctx = gatherSessionContext(sessionId);
    if (!ctx || ctx.trackCount < AI_INSIGHT_MIN_TRACKS) return null;

    const prompt = buildInsightPrompt(ctx);
    const result = await generateJson<InsightSuggestion>(prompt);

    if (!result?.insight || typeof result.insight !== 'string') return null;

    // Limit length
    const insight = result.insight.trim().slice(0, 150);
    const category = typeof result.category === 'string' ? result.category : 'pattern';

    // Persist
    insertAiSuggestion({
      sessionId,
      suggestionType: 'insight',
      prompt,
      response: JSON.stringify({ insight, category }),
    });

    // Broadcast to WebSocket clients
    broadcast({
      type: 'ai_insight',
      data: { insight, category, sessionId },
    });

    logger.info({ sessionId, insight, category }, 'AI insight generated and broadcast');
    return insight;
  } catch (err) {
    logger.warn({ err, sessionId }, 'AI insight generation failed');
    return null;
  }
}
