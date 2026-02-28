import type { TrackRow } from '../database/types.js';
import {
  RECENTLY_PLAYED_EXCLUDE_COUNT,
  TOP_CANDIDATES_FOR_RANDOM,
} from '../shared/constants.js';
import { logger } from '../shared/logger.js';
import { stateVectorManager } from './state-vector.js';
import { loadSteeringControls } from './steering.js';
import { getCandidates } from './candidate-pool.js';
import { scoreTrack } from './scorer.js';
import { processInteractionFeedback } from './feedback.js';
import { analyzeSession, generateInsight, clearSessionSuggestion, isAiEnabled } from '../ai/service.js';
import { getAiSettings } from '../database/repositories/settings.repo.js';
import type { ScoringContext, ScoredTrack } from './types.js';

/**
 * Main coordinator that ties the intelligence pipeline together:
 * state vector -> steering -> candidate pool -> scorer -> weighted random pick.
 */
class IntelligenceSelector {
  private recentTrackIds: number[] = [];
  private recentArtists: string[] = [];
  private sessionSkipCount: number = 0;
  private sessionTrackCount: number = 0;
  private targetGenre: string | null = null;

  /**
   * Set or clear a session-scoped target genre.
   * When set, the scorer favors tracks matching this genre.
   */
  setTargetGenre(genre: string | null): void {
    this.targetGenre = genre;
    logger.info({ targetGenre: genre }, 'Target genre set for session');
  }

  getTargetGenre(): string | null {
    return this.targetGenre;
  }

  /**
   * Start tracking a new session.
   */
  initSession(sessionId: number): void {
    this.recentTrackIds = [];
    this.recentArtists = [];
    this.sessionSkipCount = 0;
    this.sessionTrackCount = 0;
    this.targetGenre = null;
    stateVectorManager.initSession(sessionId);
    logger.info({ sessionId }, 'Intelligence selector session initialized');
  }

  /**
   * Clean up session state.
   */
  endSession(sessionId: number): void {
    stateVectorManager.endSession(sessionId);
    clearSessionSuggestion(sessionId);
    this.recentTrackIds = [];
    this.recentArtists = [];
    this.sessionSkipCount = 0;
    this.sessionTrackCount = 0;
    this.targetGenre = null;
    logger.info({ sessionId }, 'Intelligence selector session ended');
  }

  /**
   * Select the next track to play using the full intelligence pipeline.
   * Returns null if no suitable candidates exist.
   */
  selectNextTrack(sessionId: number, excludeIds?: Set<number>): TrackRow | null {
    // 1. Get current state vector
    const stateVector = stateVectorManager.getState(sessionId);

    // 2. Load steering controls
    const steering = loadSteeringControls();

    // 3. Build scoring context
    // Merge queue exclusion IDs into recent track IDs so getCandidates() filters them out
    const effectiveRecentIds = excludeIds && excludeIds.size > 0
      ? [...this.recentTrackIds, ...excludeIds]
      : this.recentTrackIds;

    const scoringContext: ScoringContext = {
      stateVector,
      steering,
      recentTrackIds: effectiveRecentIds,
      recentArtists: this.recentArtists,
      sessionSkipCount: this.sessionSkipCount,
      sessionTrackCount: this.sessionTrackCount,
      targetGenre: this.targetGenre,
    };

    // 4. Get candidates
    const candidates = getCandidates(scoringContext);
    if (candidates.length === 0) {
      logger.warn('No candidates available for selection');
      return null;
    }

    // 5. Score each candidate (pass sessionId for AI weight multipliers)
    const scored: ScoredTrack[] = candidates.map((track) => ({
      track,
      score: scoreTrack(track, scoringContext, sessionId),
    }));

    // 6. Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // 7. Pick from top N using weighted random (probability proportional to score)
    const topN = scored.slice(0, TOP_CANDIDATES_FOR_RANDOM);
    const selected = weightedRandomPick(topN);

    if (!selected) {
      logger.warn('Weighted random pick returned no result');
      return null;
    }

    // 8. Log selection
    logger.info(
      {
        track: selected.track.name,
        artist: selected.track.artist,
        score: selected.score.toFixed(4),
        poolSize: candidates.length,
        topScores: topN.map((s) => s.score.toFixed(4)),
      },
      'Track selected by intelligence engine',
    );

    return selected.track;
  }

  /**
   * Record that a track has been played. Updates state and history.
   */
  onTrackPlayed(sessionId: number, track: TrackRow): void {
    // Add to front of recent lists, capping at max size
    this.recentTrackIds.unshift(track.id);
    if (this.recentTrackIds.length > RECENTLY_PLAYED_EXCLUDE_COUNT) {
      this.recentTrackIds.length = RECENTLY_PLAYED_EXCLUDE_COUNT;
    }

    this.recentArtists.unshift(track.artist);
    if (this.recentArtists.length > RECENTLY_PLAYED_EXCLUDE_COUNT) {
      this.recentArtists.length = RECENTLY_PLAYED_EXCLUDE_COUNT;
    }

    this.sessionTrackCount++;

    // Update session state vector
    stateVectorManager.update(
      sessionId,
      track,
      this.sessionSkipCount,
      this.sessionTrackCount,
    );

    // Persist state snapshot
    stateVectorManager.recordToDb(sessionId);

    // Fire-and-forget AI analysis at configured intervals
    if (isAiEnabled()) {
      const { aiAnalysisInterval } = getAiSettings();
      if (this.sessionTrackCount > 0 && this.sessionTrackCount % aiAnalysisInterval === 0) {
        Promise.all([
          analyzeSession(sessionId),
          generateInsight(sessionId),
        ]).catch((err) => {
          logger.warn({ err }, 'AI analysis fire-and-forget failed');
        });
      }
    }
  }

  /**
   * Process a user interaction (play, skip, like, dislike).
   */
  onInteraction(interaction: {
    track_id: number;
    interaction_type: string;
    listen_duration_ms?: number | null;
    completion_ratio?: number | null;
  }): void {
    if (interaction.interaction_type === 'skip') {
      this.sessionSkipCount++;
    }

    processInteractionFeedback(interaction);
  }
}

/**
 * Pick from a scored list using weighted random selection,
 * where probability is proportional to each track's score.
 */
function weightedRandomPick(scored: ScoredTrack[]): ScoredTrack | null {
  if (scored.length === 0) return null;

  const totalScore = scored.reduce((sum, s) => sum + s.score, 0);
  if (totalScore <= 0) {
    // Fallback: uniform random if all scores are zero/negative
    return scored[Math.floor(Math.random() * scored.length)];
  }

  let random = Math.random() * totalScore;
  for (const entry of scored) {
    random -= entry.score;
    if (random <= 0) {
      return entry;
    }
  }

  // Fallback (shouldn't happen due to floating point, but just in case)
  return scored[scored.length - 1];
}

/** Singleton intelligence selector. */
export const selector = new IntelligenceSelector();
