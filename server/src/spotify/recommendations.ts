import { spotifyFetch } from './client.js';
import { logger } from '../shared/logger.js';

export interface SpotifyRecommendedTrack {
  spotifyId: string;
  spotifyUri: string;
  name: string;
  artist: string;
  artistId: string;
  album: string | null;
  durationMs: number;
  popularity: number;
}

export interface RecommendationOpts {
  seedTrackIds?: string[];
  seedArtistIds?: string[];
  targetEnergy?: number;
  targetValence?: number;
  limit?: number;
}

/**
 * Call GET /recommendations. Returns [] on any error (never throws).
 * Spotify enforces a max of 5 seeds total (tracks + artists).
 */
export async function getRecommendations(opts: RecommendationOpts): Promise<SpotifyRecommendedTrack[]> {
  const seedTracks = (opts.seedTrackIds ?? []).slice(0, 2);
  const seedArtists = (opts.seedArtistIds ?? []).slice(0, 5 - seedTracks.length);

  if (seedTracks.length + seedArtists.length === 0) return [];

  const params = new URLSearchParams();
  if (seedTracks.length) params.set('seed_tracks', seedTracks.join(','));
  if (seedArtists.length) params.set('seed_artists', seedArtists.join(','));
  if (opts.targetEnergy !== undefined) params.set('target_energy', opts.targetEnergy.toFixed(2));
  if (opts.targetValence !== undefined) params.set('target_valence', opts.targetValence.toFixed(2));
  params.set('limit', String(Math.min(opts.limit ?? 20, 100)));

  try {
    const data = await spotifyFetch<{ tracks: unknown[] }>(`/recommendations?${params}`);
    return (data.tracks ?? []).map((t: any) => ({
      spotifyId: t.id as string,
      spotifyUri: t.uri as string,
      name: t.name as string,
      artist: (t.artists?.[0]?.name ?? 'Unknown') as string,
      artistId: (t.artists?.[0]?.id ?? '') as string,
      album: (t.album?.name ?? null) as string | null,
      durationMs: t.duration_ms as number,
      popularity: t.popularity as number,
    }));
  } catch (err) {
    logger.warn({ err }, 'Spotify recommendations failed — using library fallback');
    return [];
  }
}

/**
 * Fetch audio features for a single track via GET /audio-features?ids={id}.
 * Returns null on any error.
 */
export async function getTrackAudioFeatures(spotifyId: string): Promise<{
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
} | null> {
  try {
    const data = await spotifyFetch<{ audio_features: unknown[] }>(
      `/audio-features?ids=${spotifyId}`,
    );
    const f: any = (data.audio_features ?? [])[0];
    if (!f) return null;
    return {
      energy: f.energy,
      valence: f.valence,
      tempo: f.tempo,
      danceability: f.danceability,
      acousticness: f.acousticness,
      instrumentalness: f.instrumentalness,
      loudness: f.loudness,
      speechiness: f.speechiness,
      key: f.key,
      mode: f.mode,
      timeSignature: f.time_signature,
    };
  } catch (err) {
    logger.warn({ err, spotifyId }, 'Audio features fetch failed for external track');
    return null;
  }
}
