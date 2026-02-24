export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO datetime
  scope: string;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volumePercent: number;
}

export interface SpotifyPlayerState {
  isPlaying: boolean;
  progressMs: number;
  device: SpotifyDevice | null;
  track: SpotifyTrack | null;
  shuffleState: boolean;
  repeatState: string;
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: { id: string; name: string }[];
  album: {
    id: string;
    name: string;
    images: { url: string; width: number; height: number }[];
  };
  durationMs: number;
}

export interface SpotifyAudioFeatures {
  id: string;
  energy: number;
  valence: number;
  tempo: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  loudness: number;
  speechiness: number;
  key: number;
  mode: number;
  timeSignature: number;
}
