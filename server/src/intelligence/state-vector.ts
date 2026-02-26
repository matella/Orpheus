import type { TrackRow } from '../database/types.js';
import { recordState } from '../database/repositories/state-history.repo.js';
import { STATE_VECTOR_ALPHA } from '../shared/constants.js';
import { logger } from '../shared/logger.js';
import type { StateVector } from './types.js';

/**
 * Manages per-session state vectors using exponential moving average blending.
 * Each active session gets its own StateVector that evolves as tracks play.
 */
export class StateVectorManager {
  private states: Map<number, StateVector> = new Map();

  /**
   * Initialize a new session with neutral defaults.
   */
  initSession(sessionId: number): void {
    const state: StateVector = {
      energy: 0.5,
      valence: 0.5,
      tempo: 120,
      genreCluster: null,
      familiarity: 0.5,
      vocalness: 0.5,
      aggressiveness: 0.3,
      context: this.getTimeContext(),
      fatigueLevel: 0,
    };
    this.states.set(sessionId, state);
    logger.debug({ sessionId, context: state.context }, 'State vector initialized');
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

    // Genre cluster: take the latest track's genre
    state.genreCluster = track.genre_cluster;

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
