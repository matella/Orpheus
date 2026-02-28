import type { TrackRow } from '../database/types.js';

/**
 * Session state vector: a running summary of what the listener has been hearing.
 * Updated via exponential moving average after each track.
 */
export interface StateVector {
  energy: number;
  valence: number;
  tempo: number;
  genreCluster: string | null;
  familiarity: number;
  vocalness: number;
  aggressiveness: number;
  context: string;
  fatigueLevel: number;
}

/**
 * User-facing steering controls, each normalized to [0, 1].
 * 0.5 = neutral / no preference.
 */
export interface SteeringControls {
  energy: number;
  mood: number;
  familiarity: number;
  vocalVsInstrumental: number;
  aggressiveness: number;
  genreOpenness: number;
  focusVsParty: number;
}

/**
 * Everything the scorer needs to evaluate a candidate track.
 */
export interface ScoringContext {
  stateVector: StateVector;
  steering: SteeringControls;
  recentTrackIds: number[];
  recentArtists: string[];
  sessionSkipCount: number;
  sessionTrackCount: number;
  /** Session-scoped target genre set by music requests (e.g. "more kpop"). */
  targetGenre?: string | null;
}

/**
 * A track together with its computed intelligence score.
 */
export interface ScoredTrack {
  track: TrackRow;
  score: number;
}

/** Neutral steering controls (all sliders centered). */
export const DEFAULT_STEERING: SteeringControls = {
  energy: 0.5,
  mood: 0.5,
  familiarity: 0.5,
  vocalVsInstrumental: 0.5,
  aggressiveness: 0.5,
  genreOpenness: 0.5,
  focusVsParty: 0.5,
};

/** Ordered list of steering control keys. */
export const STEERING_KEYS: (keyof SteeringControls)[] = [
  'energy',
  'mood',
  'familiarity',
  'vocalVsInstrumental',
  'aggressiveness',
  'genreOpenness',
  'focusVsParty',
];
