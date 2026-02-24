import { spotifyFetch } from './client.js';
import { logger } from '../shared/logger.js';
import { AUDIO_FEATURES_BATCH_SIZE } from '../shared/constants.js';
import {
  upsertTracks,
  updateAudioFeaturesBatch,
  getTracksMissingFeatures,
  type UpsertTrackData,
  type UpsertAudioFeatures,
} from '../database/repositories/track.repo.js';

/**
 * Sync all saved tracks from the user's Spotify library.
 * Pages through the entire library, upserting into the local database.
 */
export async function syncSavedTracks(): Promise<number> {
  logger.info('Starting saved tracks sync...');
  let total = 0;
  let offset = 0;
  const limit = 50; // Spotify max per page

  while (true) {
    const data = await spotifyFetch<{
      items: any[];
      total: number;
      next: string | null;
    }>(`/me/tracks?limit=${limit}&offset=${offset}`);

    if (!data.items || data.items.length === 0) break;

    const tracks: UpsertTrackData[] = data.items.map((item: any) => ({
      spotifyId: item.track.id,
      name: item.track.name,
      artist: item.track.artists.map((a: any) => a.name).join(', '),
      artistId: item.track.artists[0]?.id ?? undefined,
      album: item.track.album?.name,
      albumArtUrl: item.track.album?.images?.[0]?.url,
      durationMs: item.track.duration_ms,
      source: 'library',
    }));

    upsertTracks(tracks);
    total += tracks.length;
    offset += limit;

    logger.debug({ synced: total, libraryTotal: data.total }, 'Syncing saved tracks...');

    if (!data.next) break;
  }

  logger.info({ total }, 'Saved tracks sync complete');
  return total;
}

/**
 * Sync the user's top tracks (short, medium, and long term).
 */
export async function syncTopTracks(): Promise<number> {
  logger.info('Starting top tracks sync...');
  let total = 0;

  for (const timeRange of ['short_term', 'medium_term', 'long_term'] as const) {
    const data = await spotifyFetch<{ items: any[] }>(
      `/me/top/tracks?limit=50&time_range=${timeRange}`,
    );

    if (!data.items || data.items.length === 0) continue;

    const tracks: UpsertTrackData[] = data.items.map((item: any) => ({
      spotifyId: item.id,
      name: item.name,
      artist: item.artists.map((a: any) => a.name).join(', '),
      artistId: item.artists[0]?.id ?? undefined,
      album: item.album?.name,
      albumArtUrl: item.album?.images?.[0]?.url,
      durationMs: item.duration_ms,
      source: 'top',
    }));

    upsertTracks(tracks);
    total += tracks.length;
    logger.debug({ timeRange, count: tracks.length }, 'Synced top tracks');
  }

  logger.info({ total }, 'Top tracks sync complete');
  return total;
}

/**
 * Sync recently played tracks.
 */
export async function syncRecentlyPlayed(): Promise<number> {
  logger.info('Starting recently played sync...');

  const data = await spotifyFetch<{ items: any[] }>(
    '/me/player/recently-played?limit=50',
  );

  if (!data.items || data.items.length === 0) {
    logger.info('No recently played tracks found');
    return 0;
  }

  const tracks: UpsertTrackData[] = data.items.map((item: any) => ({
    spotifyId: item.track.id,
    name: item.track.name,
    artist: item.track.artists.map((a: any) => a.name).join(', '),
    artistId: item.track.artists[0]?.id ?? undefined,
    album: item.track.album?.name,
    albumArtUrl: item.track.album?.images?.[0]?.url,
    durationMs: item.track.duration_ms,
    source: 'recent',
  }));

  upsertTracks(tracks);
  logger.info({ total: tracks.length }, 'Recently played sync complete');
  return tracks.length;
}

/**
 * Fetch and store audio features for tracks that don't have them yet.
 * Processes in batches of 100 (Spotify API limit).
 */
export async function syncAudioFeatures(): Promise<number> {
  let totalSynced = 0;

  while (true) {
    const missingIds = getTracksMissingFeatures(AUDIO_FEATURES_BATCH_SIZE);
    if (missingIds.length === 0) break;

    logger.debug({ batch: missingIds.length }, 'Fetching audio features batch...');

    const data = await spotifyFetch<{ audio_features: any[] }>(
      `/audio-features?ids=${missingIds.join(',')}`,
    );

    if (!data.audio_features) break;

    const features: UpsertAudioFeatures[] = data.audio_features
      .filter((f: any) => f !== null)
      .map((f: any) => ({
        spotifyId: f.id,
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
      }));

    updateAudioFeaturesBatch(features);
    totalSynced += features.length;

    logger.debug({ synced: totalSynced }, 'Audio features batch complete');
  }

  logger.info({ total: totalSynced }, 'Audio features sync complete');
  return totalSynced;
}

/**
 * Run a full library sync: saved tracks, top tracks, recently played, then audio features.
 */
export async function fullLibrarySync(): Promise<{
  savedTracks: number;
  topTracks: number;
  recentTracks: number;
  audioFeatures: number;
}> {
  logger.info('=== Starting full library sync ===');

  const savedTracks = await syncSavedTracks();
  const topTracks = await syncTopTracks();
  const recentTracks = await syncRecentlyPlayed();
  const audioFeatures = await syncAudioFeatures();

  logger.info(
    { savedTracks, topTracks, recentTracks, audioFeatures },
    '=== Full library sync complete ===',
  );

  return { savedTracks, topTracks, recentTracks, audioFeatures };
}
