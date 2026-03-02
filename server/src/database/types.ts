export interface TrackRow {
  id: number;
  spotify_id: string;
  name: string;
  artist: string;
  artist_id: string | null;
  album: string | null;
  album_art_url: string | null;
  duration_ms: number;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  loudness: number | null;
  speechiness: number | null;
  key: number | null;
  mode: number | null;
  time_signature: number | null;
  genre_cluster: string | null;
  aggressiveness: number | null;
  familiarity_score: number;
  source: string;
  cached_at: string;
  features_fetched: number;
}

export interface InteractionRow {
  id: number;
  track_id: number;
  session_id: number | null;
  interaction_type: string;
  listen_duration_ms: number | null;
  completion_ratio: number | null;
  skip_position_ms: number | null;
  created_at: string;
}

export interface SessionRow {
  id: number;
  started_at: string;
  ended_at: string | null;
  device_id: string | null;
  device_name: string | null;
  track_count: number;
  total_duration_ms: number;
  avg_energy: number | null;
  avg_valence: number | null;
  initial_context: string | null;
  auto_started: number;
  session_name: string | null;
}

export interface PreferenceRow {
  track_id: number;
  score: number;
  play_count: number;
  skip_count: number;
  like_count: number;
  dislike_count: number;
  last_played_at: string | null;
  updated_at: string;
}

export interface StateHistoryRow {
  id: number;
  session_id: number;
  track_id: number | null;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  genre_cluster: string | null;
  familiarity: number | null;
  vocalness: number | null;
  aggressiveness: number | null;
  context: string | null;
  fatigue_level: number | null;
  recorded_at: string;
}

export interface SettingRow {
  key: string;
  value: string;
}

export interface AiSuggestionRow {
  id: number;
  session_id: number | null;
  suggestion_type: string;
  prompt: string;
  response: string;
  applied: number;
  created_at: string;
}

export interface MonthlyRecapRow {
  id: number;
  year: number;
  month: number;
  recap: string;
  stats: string;
  created_at: string;
}

export interface SpotifyTopArtistRow {
  id: number;
  spotify_id: string;
  name: string;
  genres: string | null;
  popularity: number | null;
  image_url: string | null;
  time_range: string;
  rank: number;
  synced_at: string;
}
