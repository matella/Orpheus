import type { TrackRow } from '../database/types.js';
import { recordState } from '../database/repositories/state-history.repo.js';
import { getTimePreferences } from '../database/repositories/time-preferences.repo.js';
import { STATE_VECTOR_ALPHA } from '../shared/constants.js';
import { clamp } from '../shared/utils.js';
import { logger } from '../shared/logger.js';
import type { StateVector } from './types.js';

/** Max sessions to keep in memory before evicting oldest. */
const MAX_CACHED_SESSIONS = 10;

/**
 * Manages per-session state vectors using exponential moving average blending.
 * Each active session gets its own StateVector that evolves as tracks play.
 */
export class StateVectorManager {
  private states: Map<number, StateVector> = new Map();

  /**
   * Initialize a new session using context-aware inference.
   * Consults learned time-of-day patterns; falls back to neutral defaults
   * if no historical data exists for the current time bracket.
   */
  initSession(sessionId: number): void {
    // Evict oldest sessions if at capacity to prevent unbounded memory growth
    if (this.states.size >= MAX_CACHED_SESSIONS) {
      const oldest = this.states.keys().next().value;
      if (oldest !== undefined) {
        this.states.delete(oldest);
        logger.debug({ evicted: oldest }, 'Evicted oldest state vector to stay under limit');
      }
    }

    const state = this.inferInitialState();
    this.states.set(sessionId, state);
    logger.debug(
      { sessionId, context: state.context, energy: state.energy.toFixed(3), source: state.genreCluster ? 'learned' : 'default' },
      'State vector initialized',
    );
  }

  /**
   * Infer the initial state vector from learned time-of-day preferences.
   * Falls back to neutral defaults if no learned data exists.
   */
  inferInitialState(): StateVector {
    const context = this.getTimeContext();
    const prefs = getTimePreferences(context);

    if (prefs && prefs.sample_count >= 2) {
      logger.info(
        { bracket: context, samples: prefs.sample_count },
        'Using learned time preferences for initial state',
      );
      return {
        energy: clamp(prefs.avg_energy, 0, 1),
        valence: clamp(prefs.avg_valence, 0, 1),
        tempo: clamp(prefs.avg_tempo, 40, 250),
        genreCluster: prefs.preferred_genres,
        genreCounts: new Map(prefs.preferred_genres ? [[prefs.preferred_genres, 1]] : []),
        familiarity: clamp(prefs.avg_familiarity, 0, 1),
        vocalness: clamp(prefs.avg_vocalness, 0, 1),
        aggressiveness: clamp(prefs.avg_aggressiveness, 0, 1),
        context,
        fatigueLevel: 0,
      };
    }

    // No learned data — use neutral defaults
    return {
      energy: 0.5,
      valence: 0.5,
      tempo: 120,
      genreCluster: null,
      genreCounts: new Map(),
      familiarity: 0.5,
      vocalness: 0.5,
      aggressiveness: 0.3,
      context,
      fatigueLevel: 0,
    };
  }

  /**
   * Get the current state vector for a session.
   * Throws if the session has not been initialized.
   */
  getState(sessionId: number): StateVector {
    const state = this.states.get(sessionId);
    if (!state) {
      throw new Error(`State vector not initialized for session ${sessionId}`);
    }
    return state;
  }

  /**
   * Blend a newly played track into the session state via EMA.
   */
  update(
    sessionId: number,
    track: TrackRow,
    skipCount: number,
    trackCount: number,
  ): void {
    const state = this.getState(sessionId);
    const alpha = STATE_VECTOR_ALPHA;

    // EMA blend for each numeric dimension
    state.energy = state.energy * (1 - alpha) + (track.energy ?? 0.5) * alpha;
    state.valence = state.valence * (1 - alpha) + (track.valence ?? 0.5) * alpha;
    state.tempo = state.tempo * (1 - alpha) + (track.tempo ?? 120) * alpha;
    state.familiarity =
      state.familiarity * (1 - alpha) + track.familiarity_score * alpha;
    state.vocalness =
      state.vocalness * (1 - alpha) + (1 - (track.instrumentalness ?? 0.5)) * alpha;
    state.aggressiveness =
      state.aggressiveness * (1 - alpha) + (track.aggressiveness ?? 0.3) * alpha;

    // Genre cluster: track frequency and use the dominant genre in this session.
    // This prevents a single outlier track from flipping the reference genre.
    if (track.genre_cluster) {
      state.genreCounts.set(
        track.genre_cluster,
        (state.genreCounts.get(track.genre_cluster) ?? 0) + 1,
      );
      // Determine dominant genre
      let maxCount = 0;
      let dominant: string | null = null;
      for (const [genre, count] of state.genreCounts) {
        if (count > maxCount) {
          maxCount = count;
          dominant = genre;
        }
      }
      state.genreCluster = dominant;
    }

    // Fatigue: ratio of skips to total tracks
    state.fatigueLevel =
      trackCount > 0 ? Math.min(1, skipCount / trackCount) : 0;

    // Refresh time-of-day context
    state.context = this.getTimeContext();

    logger.debug(
      { sessionId, energy: state.energy.toFixed(3), valence: state.valence.toFixed(3) },
      'State vector updated',
    );
  }

  /**
   * Persist the current state vector snapshot to the database.
   */
  recordToDb(sessionId: number): void {
    const state = this.getState(sessionId);
    recordState({
      sessionId,
      energy: state.energy,
      valence: state.valence,
      tempo: state.tempo,
      genreCluster: state.genreCluster ?? undefined,
      familiarity: state.familiarity,
      vocalness: state.vocalness,
      aggressiveness: state.aggressiveness,
      context: state.context,
      fatigueLevel: state.fatigueLevel,
    });
  }

  /**
   * Remove session state from memory.
   */
  endSession(sessionId: number): void {
    this.states.delete(sessionId);
    logger.debug({ sessionId }, 'State vector session ended');
  }

  /**
   * Determine the current time-of-day context bracket.
   */
  private getTimeContext(): string {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
  }
}

/** Singleton state vector manager. */
export const stateVectorManager = new StateVectorManager();
