import type { TrackRow } from '../database/types.js';
import { getPreference } from '../database/repositories/preference.repo.js';
import {
  DEFAULT_WEIGHTS,
  SKIP_FATIGUE_THRESHOLD,
  FATIGUE_NOVELTY_BOOST,
} from '../shared/constants.js';
import { getActiveWeightSuggestion } from '../ai/service.js';
import type { ScoringContext } from './types.js';

/**
 * Score a single candidate track against the current context.
 *
 * Returns a value in roughly [0, 1] representing how well the track
 * fits the listener's current session state and steering preferences.
 */
export function scoreTrack(track: TrackRow, context: ScoringContext, sessionId?: number): number {
  const { stateVector: state, steering } = context;

  // ---- 1. Compute adjusted weights ----
  const weights = { ...DEFAULT_WEIGHTS } as Record<string, number>;

  if (steering.familiarity > 0.6) {
    weights.preference *= 1.4;
    weights.novelty *= 0.6;
  }
  if (steering.familiarity < 0.4) {
    weights.novelty *= 1.4;
    weights.preference *= 0.6;
    weights.recency *= 2.0; // Boost recency in explore mode — favors unplayed tracks
  }
  if (steering.genreOpenness < 0.4) {
    weights.genre *= 1.5;     // Low openness = stronger genre lock
    weights.transition *= 1.3;
  }
  if (steering.genreOpenness > 0.7) {
    weights.genre *= 0.5;     // High openness = relax genre constraint
  }
  if (steering.focusVsParty < 0.4) {
    weights.transition *= 1.3;
  }

  // Apply AI weight multipliers (if available)
  if (sessionId != null) {
    const aiSuggestion = getActiveWeightSuggestion(sessionId);
    if (aiSuggestion) {
      weights.stateSimilarity *= aiSuggestion.stateSimilarity;
      weights.genre *= aiSuggestion.genre;
      weights.preference *= aiSuggestion.preference;
      weights.novelty *= aiSuggestion.novelty;
      weights.transition *= aiSuggestion.transition;
      weights.fatigue *= aiSuggestion.fatigue;
      weights.context *= aiSuggestion.context;
      weights.recency *= aiSuggestion.recency;
    }
  }

  // Normalize so weights sum to 1.0 (with safety guard for zero/negative sums)
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (weightSum <= 0) {
    // All weights zeroed out — reset to safe defaults
    Object.assign(weights, DEFAULT_WEIGHTS);
  } else {
    for (const key of Object.keys(weights)) {
      weights[key] /= weightSum;
    }
  }

  // ---- 2. Steering-adjusted target state ----
  const targetEnergy = state.energy * 0.6 + steering.energy * 0.4;
  const targetValence = state.valence * 0.6 + steering.mood * 0.4;
  const targetVocalness = state.vocalness * 0.6 + steering.vocalVsInstrumental * 0.4;
  const targetAggressiveness =
    state.aggressiveness * 0.6 + steering.aggressiveness * 0.4;

  // ---- 3. Dimension scores (each 0-1) ----

  // --- stateSimilarity: Euclidean distance in 5D ---
  // All dimensions normalized to [0, 1] for equal weighting.
  // Tempo uses relative delta (consistent with transition score) clamped to [0, 1].
  const trackVocalness = 1 - (track.instrumentalness ?? 0.5);
  const tempoDiff = Math.min(1, Math.abs((track.tempo ?? 120) - state.tempo) / Math.max(1, state.tempo));
  const diffs = [
    (track.energy ?? 0.5) - targetEnergy,
    (track.valence ?? 0.5) - targetValence,
    tempoDiff * Math.sign((track.tempo ?? 120) - state.tempo), // Signed relative tempo diff [−1, 1]
    trackVocalness - targetVocalness,
    (track.aggressiveness ?? 0.3) - targetAggressiveness,
  ];
  const distance = Math.sqrt(diffs.reduce((sum, d) => sum + d * d, 0));
  // Normalize by sqrt(N) — max distance in N-dimensional unit space
  const stateSimilarity = Math.max(0, 1 - distance / Math.sqrt(diffs.length));

  // --- preference + recency: single DB query for both ---
  const prefRow = getPreference(track.id);
  const preference = prefRow?.score ?? 0.5;

  // --- novelty: use actual play count for familiarity instead of static score ---
  const playCount = prefRow?.play_count ?? 0;
  const familiarityFromPlays = Math.min(1, playCount / 20); // 20 plays = fully familiar
  const genreDiversityBonus =
    track.genre_cluster &&
    !context.recentArtists.some((a) => a === track.artist)
      ? 1
      : 0;
  const neverPlayedBonus = playCount === 0 ? 0.3 : 0;
  let novelty =
    (1 - familiarityFromPlays) * 0.5 + genreDiversityBonus * 0.2 + neverPlayedBonus;

  const skipRatio =
    context.sessionSkipCount / Math.max(1, context.sessionTrackCount);
  if (skipRatio > SKIP_FATIGUE_THRESHOLD) {
    novelty = Math.min(1, novelty * FATIGUE_NOVELTY_BOOST);
  }

  // --- genre: standalone genre coherence dimension ---
  // Prefer tracks matching the session's dominant genre or an explicit target genre.
  // Genre mismatch is heavily penalized to prevent jarring cross-genre jumps.
  const referenceGenre = context.targetGenre || state.genreCluster;
  let genre: number;
  if (!referenceGenre || !track.genre_cluster) {
    genre = 0.5; // No genre data — neutral
  } else if (referenceGenre === track.genre_cluster) {
    genre = 1.0; // Perfect match
  } else {
    genre = 0.1; // Genre mismatch — strong penalty
  }

  // --- transition: audio smoothness (pure audio features, no genre) ---
  const bpmDelta =
    Math.abs((track.tempo ?? 120) - state.tempo) / Math.max(1, state.tempo);
  const energyDelta = Math.abs((track.energy ?? 0.5) - state.energy);
  const valenceDelta = Math.abs((track.valence ?? 0.5) - state.valence);
  const aggressivenessDelta = Math.abs((track.aggressiveness ?? 0.3) - state.aggressiveness);

  // Clamp to [0, 1] — bpmDelta can exceed 1.0 when candidate pool relaxes proximity filters
  const transition = Math.max(0, 1 - (bpmDelta + energyDelta + valenceDelta + aggressivenessDelta) / 4);

  // --- fatigue: placeholder (always 1.0 for now) ---
  const fatigue = 1.0;

  // --- context: time-of-day heuristic ---
  const contextScore = computeContextScore(
    track.energy ?? 0.5,
    track.valence ?? 0.5,
    steering.focusVsParty,
  );

  // --- recency: time since last played (reuses prefRow from above) ---
  let recency = 1.0;
  if (prefRow?.last_played_at) {
    const lastPlayed = new Date(prefRow.last_played_at).getTime();
    const daysSince = (Date.now() - lastPlayed) / (1000 * 60 * 60 * 24);
    recency = Math.min(daysSince / 30, 1);
  }

  // ---- 4. Weighted sum ----
  const score =
    weights.stateSimilarity * stateSimilarity +
    weights.genre * genre +
    weights.preference * preference +
    weights.transition * transition +
    weights.novelty * novelty +
    weights.fatigue * fatigue +
    weights.context * contextScore +
    weights.recency * recency;

  return score;
}

/**
 * Compute a context (time-of-day) score for a track's energy level.
 * Returns a value in [0, 1].
 */
function computeContextScore(
  trackEnergy: number,
  trackValence: number,
  focusVsParty: number,
): number {
  const hour = new Date().getHours();

  // Preferred energy ranges by time bracket
  let preferredMin: number;
  let preferredMax: number;

  if (hour >= 6 && hour < 12) {
    // Morning: prefer energy < 0.6
    preferredMin = 0;
    preferredMax = 0.6;
  } else if (hour >= 12 && hour < 17) {
    // Afternoon: prefer energy 0.4-0.8
    preferredMin = 0.4;
    preferredMax = 0.8;
  } else if (hour >= 17 && hour < 22) {
    // Evening: prefer energy 0.3-0.7
    preferredMin = 0.3;
    preferredMax = 0.7;
  } else {
    // Night: prefer energy < 0.4
    preferredMin = 0;
    preferredMax = 0.4;
  }

  // Score is 1.0 if in range, linear decay outside
  let timeScore: number;
  if (trackEnergy >= preferredMin && trackEnergy <= preferredMax) {
    timeScore = 1.0;
  } else if (trackEnergy < preferredMin) {
    timeScore = Math.max(0, 1 - (preferredMin - trackEnergy) / 0.3);
  } else {
    timeScore = Math.max(0, 1 - (trackEnergy - preferredMax) / 0.3);
  }

  // Bias from focusVsParty steering:
  // Low (focus) -> prefer lower energy/valence
  // High (party) -> prefer higher energy/valence
  const partyBias = focusVsParty - 0.5; // [-0.5, 0.5]
  const energyFit = 1 - Math.abs(trackEnergy - (0.5 + partyBias * 0.4));
  const valenceFit = 1 - Math.abs(trackValence - (0.5 + partyBias * 0.3));
  const steeringScore = (energyFit + valenceFit) / 2;

  // Blend time-of-day with steering preference
  return timeScore * 0.6 + steeringScore * 0.4;
}
