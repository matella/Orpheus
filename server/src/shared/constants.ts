// Spotify polling interval (ms)
export const PLAYER_POLL_INTERVAL_MS = 5000;

// Library sync intervals
export const LIBRARY_SYNC_INTERVAL_HOURS = 6;
export const RECENT_SYNC_INTERVAL_MINUTES = 30;

// Audio feature batch size for Spotify API
export const AUDIO_FEATURES_BATCH_SIZE = 100;

// Playback engine
export const TRACK_BUFFER_MIN_SIZE = 2; // minimum lookahead: next + buffer

// State vector EMA blending factor (lower = more inertia, slower genre drift)
export const STATE_VECTOR_ALPHA = 0.2;

// Scoring weights (defaults)
export const DEFAULT_WEIGHTS = {
  stateSimilarity: 0.20,
  genre: 0.15,
  preference: 0.15,
  transition: 0.15,
  novelty: 0.10,
  fatigue: 0.10,
  context: 0.10,
  recency: 0.05,
} as const;

// Fatigue thresholds
export const SKIP_FATIGUE_THRESHOLD = 0.4; // 40% skip rate triggers fatigue
export const FATIGUE_NOVELTY_BOOST = 1.5; // 50% boost to novelty weight

// Learning deltas
export const LEARNING = {
  completionPositive: 0.05,    // >80% listened
  skipNegative: -0.10,         // <30s skip
  skipMildNegative: -0.03,     // 30-60s skip
  likePositive: 0.20,
  dislikeNegative: -0.30,      // Asymmetric: dislikes matter more
} as const;

// Anti-repetition
export const RECENTLY_PLAYED_EXCLUDE_COUNT = 50;
export const SAME_ARTIST_LOOKBACK = 5;
export const SAME_GENRE_LOOKBACK = 10;

// Candidate pool
export const BPM_PROXIMITY_THRESHOLD = 0.25; // Within 25%
export const ENERGY_PROXIMITY_THRESHOLD = 0.3;
export const TOP_CANDIDATES_FOR_RANDOM = 3;

// Steering debounce
export const STEERING_DEBOUNCE_MS = 300;

// AI integration
export const AI_ANALYSIS_INTERVAL = 5; // Analyze session every N tracks
export const AI_REQUEST_TIMEOUT_MS = 15000; // 15s max for Ollama calls
export const AI_WEIGHT_MULTIPLIER_MIN = 0.5; // Floor for AI weight multipliers
export const AI_WEIGHT_MULTIPLIER_MAX = 2.0; // Ceiling for AI weight multipliers
export const AI_MAX_CONTEXT_HISTORY = 20; // Max state history entries in prompt
export const AI_INSIGHT_MIN_TRACKS = 3; // Min tracks before generating insight
