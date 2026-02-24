import type { TrackRow } from '../database/types.js';

export interface PlaybackTrack {
  id: number;           // Internal DB id
  spotifyId: string;
  uri: string;          // spotify:track:xxx
  name: string;
  artist: string;
  album: string | null;
  albumArtUrl: string | null;
  durationMs: number;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
}

export interface EngineState {
  status: 'idle' | 'running' | 'paused' | 'stopping';
  sessionId: number | null;
  deviceId: string | null;
  deviceName: string | null;
  currentTrackSpotifyId: string | null;
  trackCount: number;
  startedAt: string | null;
}

/**
 * Convert a database TrackRow to a PlaybackTrack.
 */
export function toPlaybackTrack(row: TrackRow): PlaybackTrack {
  return {
    id: row.id,
    spotifyId: row.spotify_id,
    uri: `spotify:track:${row.spotify_id}`,
    name: row.name,
    artist: row.artist,
    album: row.album,
    albumArtUrl: row.album_art_url,
    durationMs: row.duration_ms,
    energy: row.energy,
    valence: row.valence,
    tempo: row.tempo,
  };
}
