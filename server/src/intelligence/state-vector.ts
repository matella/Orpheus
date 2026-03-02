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

  /** Evict oldest session if at capacity to prevent unbounded memory growth. */
  private ensureCapacity(): void {
    if (this.states.size >= MAX_CACHED_SESSIONS) {
      const oldest = this.states.keys().next().value;
      if (oldest !== undefined) {
        this.states.delete(oldest);
        logger.debug({ evicted: oldest }, 'Evicted oldest state vector to stay under limit');
      }
    }
  }

  /**
   * Initialize a new session using context-aware inference.
   * Consults learned time-of-day patterns; falls back to neutral defaults
   * if no historical data exists for the current time bracket.
   */
  initSession(sessionId: number): void {
    this.ensureCapacity();

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
   * Initialize a session state vector from a set of seed tracks (e.g. the
   * current track + coherent queue items discovered at engine startup).
   *
   * Computes a weighted average of audio features across all seeds, giving
   * the first track (currently playing) double weight so the state is
   * anchored to what the user is hearing right now.
   */
  seedFromTracks(sessionId: number, seedTracks: TrackRow[]): void {
    this.ensureCapacity();

    if (seedTracks.length === 0) {
      // No seed data — fall back to time-based inference
      this.initSession(sessionId);
      return;
    }

    const context = this.getTimeContext();

    // Assign weights: first track (currently playing) = 2, rest = 1
    const weights = seedTracks.map((_, i) => (i === 0 ? 2 : 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    let energy = 0;
    let valence = 0;
    let tempo = 0;
    let familiarity = 0;
    let vocalness = 0;
    let aggressiveness = 0;
    const genreCounts = new Map<string, number>();

    for (let i = 0; i < seedTracks.length; i++) {
      const t = seedTracks[i];
      const w = weights[i];

      energy += (t.energy ?? 0.5) * w;
      valence += (t.valence ?? 0.5) * w;
      tempo += (t.tempo ?? 120) * w;
      familiarity += t.familiarity_score * w;
      vocalness += (1 - (t.instrumentalness ?? 0.5)) * w;
      aggressiveness += (t.aggressiveness ?? 0.3) * w;

      if (t.genre_cluster) {
        genreCounts.set(t.genre_cluster, (genreCounts.get(t.genre_cluster) ?? 0) + w);
      }
    }

    // Determine dominant genre
    let dominant: string | null = null;
    let maxCount = 0;
    for (const [genre, count] of genreCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominant = genre;
      }
    }

    const state: StateVector = {
      energy: clamp(energy / totalWeight, 0, 1),
      valence: clamp(valence / totalWeight, 0, 1),
      tempo: clamp(tempo / totalWeight, 40, 250),
      genreCluster: dominant,
      genreCounts,
      familiarity: clamp(familiarity / totalWeight, 0, 1),
      vocalness: clamp(vocalness / totalWeight, 0, 1),
      aggressiveness: clamp(aggressiveness / totalWeight, 0, 1),
      context,
      fatigueLevel: 0,
    };

    this.states.set(sessionId, state);
    logger.info(
      {
        sessionId,
        seedCount: seedTracks.length,
        energy: state.energy.toFixed(3),
        genre: state.genreCluster,
        context,
      },
      'State vector seeded from existing tracks',
    );
  }

  /**
   * Get the current state vector for a session.
   * Returns null if the session has not been initialized (e.g. after stop() races
   * with an in-flight poll that references a cleaned-up session).
   */
  getState(sessionId: number): StateVector | null {
    return this.states.get(sessionId) ?? null;
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
    if (!state) {
      logger.warn({ sessionId }, 'State vector update skipped — session already ended');
      return;
    }
    const alpha = STATE_VECTOR_ALPHA;

    // EMA blend for each numeric dimension.
    // Skip dimensions where the track's feature is null/undefined to avoid
    // drifting the state toward artificial defaults (0.5) when data is missing.
    if (track.energy != null) {
      state.energy = state.energy * (1 - alpha) + track.energy * alpha;
    }
    if (track.valence != null) {
      state.valence = state.valence * (1 - alpha) + track.valence * alpha;
    }
    if (track.tempo != null) {
      state.tempo = state.tempo * (1 - alpha) + track.tempo * alpha;
    }
    state.familiarity =
      state.familiarity * (1 - alpha) + track.familiarity_score * alpha;
    if (track.instrumentalness != null) {
      state.vocalness =
        state.vocalness * (1 - alpha) + (1 - track.instrumentalness) * alpha;
    }
    if (track.aggressiveness != null) {
      state.aggressiveness =
        state.aggressiveness * (1 - alpha) + track.aggressiveness * alpha;
    }

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
    if (!state) return; // Session already ended — skip silently
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
