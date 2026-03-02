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
import { getSessionById, updateSessionName } from '../database/repositories/session.repo.js';
import { insertAiSuggestion } from '../database/repositories/ai-suggestion.repo.js';
import { getTopPreferences } from '../database/repositories/preference.repo.js';
import { getTopArtistNames, getTopArtistGenreDistribution } from '../database/repositories/top-artists.repo.js';
import { getTrackById } from '../database/repositories/track.repo.js';
import { loadSteeringControls } from '../intelligence/steering.js';
import { stateVectorManager } from '../intelligence/state-vector.js';
import { engine } from '../playback/engine.js';
import { broadcast } from '../api/websocket.js';
import { generate, generateJson } from './ollama.js';
import {
  buildWeightSuggestionPrompt,
  buildSessionNamePrompt,
  buildInsightPrompt,
  buildSessionRecapPrompt,
  buildMonthlyRecapPrompt,
  buildContextInferencePrompt,
  buildPromptParsePrompt,
  buildArtistSuggestionPrompt,
  type ArtistSuggestion,
  type SpotifyGlobalContext,
  type WeightSuggestion,
  type SessionNameSuggestion,
  type InsightSuggestion,
  type SessionRecapSuggestion,
  type MonthlyRecapSuggestion,
  type ContextInferenceSuggestion,
  type ParsedMusicRequest,
  type SessionContext,
  type SessionRecapContext,
  type MonthlyRecapContext,
  type ContextInferenceInput,
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

// ── Spotify Global Context ─────────────────────────────────────────

function gatherSpotifyGlobalContext(): SpotifyGlobalContext | null {
  try {
    const shortTermArtists = getTopArtistNames('short_term', 10);
    const mediumTermArtists = getTopArtistNames('medium_term', 10);
    const artistGenres = getTopArtistGenreDistribution();

    // Get top 10 preferred tracks and resolve names
    const topPrefs = getTopPreferences(10);
    const topPreferredTracks = topPrefs.map((pref) => {
      const track = getTrackById(pref.track_id);
      return {
        name: track?.name ?? 'Unknown',
        artist: track?.artist ?? 'Unknown',
        score: pref.score,
      };
    });

    // Build a concise listening profile string
    const parts: string[] = [];
    if (shortTermArtists.length > 0) {
      parts.push(`Recently listening to: ${shortTermArtists.slice(0, 5).join(', ')}`);
    }
    if (artistGenres.length > 0) {
      parts.push(`Dominant genres: ${artistGenres.slice(0, 5).map((g) => g.genre).join(', ')}`);
    }

    return {
      topArtistsShortTerm: shortTermArtists,
      topArtistsMediumTerm: mediumTermArtists,
      dominantGenres: artistGenres.slice(0, 10),
      topPreferredTracks,
      listeningProfile: parts.join('. ') || 'No listening data available yet.',
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to gather Spotify global context');
    return null;
  }
}

// ── Context Gathering ──────────────────────────────────────────────

function gatherSessionContext(sessionId: number): SessionContext | null {
  const session = getSessionById(sessionId);
  if (!session) return null;

  const stateHistory = getStateHistory(sessionId);
  const interactions = getSessionInteractions(sessionId);

  let currentState = stateVectorManager.getState(sessionId);
  if (!currentState) {
    // Session state not initialized — use last history entry or defaults.
    // Rebuild genreCounts from the full state history (not just the last entry)
    // so the AI prompt sees the real genre distribution.
    const last = stateHistory[stateHistory.length - 1];
    if (!last) return null;
    const fallbackGenreCounts = new Map<string, number>();
    for (const entry of stateHistory) {
      if (entry.genre_cluster) {
        fallbackGenreCounts.set(entry.genre_cluster, (fallbackGenreCounts.get(entry.genre_cluster) ?? 0) + 1);
      }
    }
    currentState = {
      energy: last.energy ?? 0.5,
      valence: last.valence ?? 0.5,
      tempo: last.tempo ?? 120,
      genreCluster: last.genre_cluster,
      genreCounts: fallbackGenreCounts,
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

  // Gather global Spotify listening context for AI enrichment
  const spotifyGlobal = gatherSpotifyGlobalContext();

  // Gather transition context if engine is in a transition state
  const engineState = engine.getState();
  const transitionContext = engineState.transitionMode !== 'none'
    ? {
        adoptedTrackCount: engineState.adoptedTrackCount,
        coherenceScore: engineState.coherenceScore ?? 0,
        transitionMode: engineState.transitionMode as 'observing' | 'autonomous',
      }
    : null;

  return {
    sessionId,
    trackCount: session.track_count,
    stateTrajectory,
    currentState,
    steering,
    recentInteractions,
    skipRate,
    dominantGenres,
    spotifyGlobal,
    transitionContext,
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
      'stateSimilarity', 'genre', 'preference', 'transition',
      'novelty', 'fatigue', 'context', 'recency',
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

    // Persist to ai_suggestions and update session row
    insertAiSuggestion({
      sessionId,
      suggestionType: 'name',
      prompt,
      response: JSON.stringify({ name }),
    });
    updateSessionName(sessionId, name);

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

/**
 * Generate an end-of-session recap and broadcast it.
 */
export async function generateSessionRecap(sessionId: number): Promise<SessionRecapSuggestion | null> {
  if (!isAiEnabled()) return null;

  try {
    const session = getSessionById(sessionId);
    if (!session) return null;

    const stateHistory = getStateHistory(sessionId);
    if (stateHistory.length < 3) return null;

    const interactions = getSessionInteractions(sessionId);
    const playSkip = interactions.filter(
      (i) => i.interaction_type === 'play' || i.interaction_type === 'skip',
    );
    const skipCount = playSkip.filter((i) => i.interaction_type === 'skip').length;
    const skipRate = playSkip.length > 0 ? skipCount / playSkip.length : 0;

    const avgEnergy = stateHistory.reduce((s, h) => s + (h.energy ?? 0.5), 0) / stateHistory.length;
    const avgValence = stateHistory.reduce((s, h) => s + (h.valence ?? 0.5), 0) / stateHistory.length;

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

    const startHour = new Date(session.started_at).getHours();
    const timeOfDay =
      startHour >= 6 && startHour < 12 ? 'morning' :
      startHour >= 12 && startHour < 17 ? 'afternoon' :
      startHour >= 17 && startHour < 22 ? 'evening' : 'night';

    // Build energy arc description
    const quarter = Math.floor(stateHistory.length / 4);
    const firstQuarter = stateHistory.slice(0, quarter);
    const lastQuarter = stateHistory.slice(-quarter);
    const firstAvg = firstQuarter.reduce((s, h) => s + (h.energy ?? 0.5), 0) / (firstQuarter.length || 1);
    const lastAvg = lastQuarter.reduce((s, h) => s + (h.energy ?? 0.5), 0) / (lastQuarter.length || 1);
    const energyArc = lastAvg > firstAvg + 0.1 ? 'building up'
      : lastAvg < firstAvg - 0.1 ? 'winding down'
      : 'steady';

    const durationMinutes = session.total_duration_ms
      ? Math.round(session.total_duration_ms / 60000)
      : stateHistory.length * 3;

    const ctx: SessionRecapContext = {
      trackCount: session.track_count,
      durationMinutes,
      avgEnergy,
      avgValence,
      dominantGenres,
      timeOfDay,
      skipRate,
      energyArc,
    };

    const prompt = buildSessionRecapPrompt(ctx);
    const result = await generateJson<SessionRecapSuggestion>(prompt);

    if (!result?.recap || typeof result.recap !== 'string') return null;

    // Persist
    insertAiSuggestion({
      sessionId,
      suggestionType: 'recap',
      prompt,
      response: JSON.stringify(result),
    });

    // Broadcast
    broadcast({
      type: 'session_recap',
      data: { sessionId, recap: result.recap, mood: result.mood },
    });

    logger.info({ sessionId, mood: result.mood }, 'AI session recap generated');
    return result;
  } catch (err) {
    logger.warn({ err, sessionId }, 'AI session recap generation failed');
    return null;
  }
}

/**
 * Generate a monthly listening recap via AI.
 */
export async function generateMonthlyRecap(
  ctx: MonthlyRecapContext,
): Promise<MonthlyRecapSuggestion | null> {
  if (!isAiEnabled()) return null;

  try {
    const prompt = buildMonthlyRecapPrompt(ctx);
    const result = await generateJson<MonthlyRecapSuggestion>(prompt, { timeout: 30000 });

    if (!result?.recap || typeof result.recap !== 'string') return null;

    logger.info(
      { year: ctx.year, month: ctx.month, personality: result.personality },
      'Monthly recap generated',
    );
    return result;
  } catch (err) {
    logger.warn({ err, year: ctx.year, month: ctx.month }, 'Monthly recap generation failed');
    return null;
  }
}

/**
 * Use AI to infer the ideal initial state for a new session.
 * Returns null if AI is unavailable; caller should fall back to rule-based inference.
 */
export async function inferContextViaAi(
  input: ContextInferenceInput,
): Promise<ContextInferenceSuggestion | null> {
  if (!isAiEnabled()) return null;

  try {
    const prompt = buildContextInferencePrompt(input);
    const result = await generateJson<ContextInferenceSuggestion>(prompt);

    if (!result || typeof result.energy !== 'number') return null;

    // Clamp values to valid ranges
    result.energy = Math.max(0, Math.min(1, result.energy));
    result.valence = Math.max(0, Math.min(1, result.valence));
    result.tempo = Math.max(60, Math.min(200, result.tempo));
    result.familiarity = Math.max(0, Math.min(1, result.familiarity));
    result.vocalness = Math.max(0, Math.min(1, result.vocalness));
    result.aggressiveness = Math.max(0, Math.min(1, result.aggressiveness));

    logger.info(
      { energy: result.energy.toFixed(2), reasoning: result.reasoning },
      'AI context inference complete',
    );
    return result;
  } catch (err) {
    logger.warn({ err }, 'AI context inference failed');
    return null;
  }
}

/**
 * Parse a natural language music request via AI.
 * Returns null if AI is unavailable or parsing fails (caller should use keyword fallback).
 */
export async function parseUserMusicRequest(
  prompt: string,
): Promise<ParsedMusicRequest | null> {
  if (!isAiEnabled()) return null;

  try {
    const aiPrompt = buildPromptParsePrompt(prompt);
    const result = await generateJson<ParsedMusicRequest>(aiPrompt, { timeout: 10000 });

    if (!result) return null;

    // Validate and normalize shape
    return {
      artists: Array.isArray(result.artists) ? result.artists.map(String) : [],
      genres: Array.isArray(result.genres) ? result.genres.map(String) : [],
      moods: Array.isArray(result.moods) ? result.moods.map(String) : [],
      descriptors: Array.isArray(result.descriptors) ? result.descriptors.map(String) : [],
      trackCount: typeof result.trackCount === 'number' ? result.trackCount : 5,
      searchSpotify: result.searchSpotify ?? true,
    };
  } catch (err) {
    logger.warn({ err }, 'AI music request parsing failed');
    return null;
  }
}

/**
 * Ask the AI to suggest specific artist names matching a vague music description.
 * Used as a fallback when keyword/genre search returns insufficient results.
 * Returns null if AI is unavailable or suggestion fails (caller should skip this step).
 */
export async function suggestArtistsForRequest(
  prompt: string,
): Promise<string[] | null> {
  if (!isAiEnabled()) return null;

  try {
    const aiPrompt = buildArtistSuggestionPrompt(prompt);
    const result = await generateJson<ArtistSuggestion>(aiPrompt, { timeout: 15000 });

    if (!result || !Array.isArray(result.artists) || result.artists.length === 0) {
      return null;
    }

    // Validate: keep only non-empty strings, limit to 8
    const artists = result.artists
      .map(String)
      .map((a) => a.trim())
      .filter((a) => a.length > 0 && a.length < 80)
      .slice(0, 8);

    if (artists.length === 0) return null;

    logger.info({ prompt, artists }, 'AI artist suggestion generated');
    return artists;
  } catch (err) {
    logger.warn({ err }, 'AI artist suggestion failed');
    return null;
  }
}
