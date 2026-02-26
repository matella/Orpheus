import { spotifyFetch } from './client.js';
import { SpotifyApiError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import { AUDIO_FEATURES_BATCH_SIZE } from '../shared/constants.js';
import {
  upsertTracks,
  updateAudioFeaturesBatch,
  getTracksMissingFeatures,
  markTracksWithDefaultFeatures,
  getTrackBySpotifyId,
  getArtistIdsMissingGenres,
  setGenreClusterByArtist,
  type UpsertTrackData,
  type UpsertAudioFeatures,
} from '../database/repositories/track.repo.js';
import { getSetting, setSetting } from '../database/repositories/settings.repo.js';
import { recordInteraction } from '../database/repositories/interaction.repo.js';
import { recordPlay, updatePreference } from '../database/repositories/preference.repo.js';

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
 * Sync recently played tracks and record them as interactions.
 * Uses a cursor stored in settings to avoid re-importing the same plays.
 */
export async function syncRecentlyPlayed(): Promise<number> {
  logger.info('Starting recently played sync...');

  // Read cursor — ISO timestamp of the most recent played_at we've processed
  const cursor = getSetting('recent_played_cursor');
  let url = '/me/player/recently-played?limit=50';
  if (cursor) {
    const cursorMs = new Date(cursor).getTime();
    url += `&after=${cursorMs}`;
  }

  const data = await spotifyFetch<{ items: any[] }>(url);

  if (!data.items || data.items.length === 0) {
    logger.info('No new recently played tracks');
    return 0;
  }

  // Upsert track metadata
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

  // Record each play as an interaction with its original timestamp
  let recorded = 0;
  let newestTimestamp = cursor;

  for (const item of data.items) {
    const playedAt: string = item.played_at;

    // Dedup guard: skip if we've already processed this timestamp
    if (cursor && playedAt <= cursor) continue;

    const trackRow = getTrackBySpotifyId(item.track.id);
    if (!trackRow) continue;

    recordInteraction({
      trackId: trackRow.id,
      interactionType: 'play',
      listenDurationMs: item.track.duration_ms,
      completionRatio: 1.0,
      createdAt: playedAt,
    });

    recordPlay(trackRow.id, playedAt);
    recorded++;

    // Track the newest timestamp for cursor update
    if (!newestTimestamp || playedAt > newestTimestamp) {
      newestTimestamp = playedAt;
    }
  }

  // Update cursor to newest played_at
  if (newestTimestamp) {
    setSetting('recent_played_cursor', newestTimestamp);
  }

  logger.info({ total: tracks.length, newInteractions: recorded }, 'Recently played sync complete');
  return tracks.length;
}

/**
 * Fetch and store audio features for tracks that don't have them yet.
 * Processes in batches of 100 (Spotify API limit).
 *
 * If Spotify returns 403 (restricted endpoint for new apps since late 2024),
 * marks all unfetched tracks with neutral default values so the engine can
 * still function — scoring will be less precise but playback works.
 */
export async function syncAudioFeatures(): Promise<number> {
  let totalSynced = 0;

  while (true) {
    const missingIds = getTracksMissingFeatures(AUDIO_FEATURES_BATCH_SIZE);
    if (missingIds.length === 0) break;

    logger.debug({ batch: missingIds.length }, 'Fetching audio features batch...');

    try {
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
    } catch (err) {
      // Spotify restricted audio-features for new apps (403).
      // Fall back to neutral defaults so the engine can still select tracks.
      if (err instanceof SpotifyApiError && err.statusCode === 403) {
        logger.warn(
          'Audio features endpoint returned 403 — Spotify restricts this for new apps. ' +
          'Marking tracks with neutral defaults so the engine can function.',
        );
        const marked = markTracksWithDefaultFeatures();
        logger.info({ marked }, 'Tracks marked with default audio features');
        return marked;
      }
      throw err;
    }
  }

  logger.info({ total: totalSynced }, 'Audio features sync complete');
  return totalSynced;
}

/**
 * Bootstrap preference scores from Spotify top tracks rankings.
 * One-time operation — guarded by a settings flag.
 * Returns true if bootstrapping was performed, false if already done.
 */
export async function bootstrapPreferencesFromTopTracks(): Promise<boolean> {
  if (getSetting('top_tracks_bootstrapped') === 'true') {
    return false;
  }

  logger.info('Bootstrapping preferences from top tracks...');

  const scoreRanges: Record<string, { top: number; bottom: number }> = {
    short_term: { top: 0.85, bottom: 0.55 },
    medium_term: { top: 0.80, bottom: 0.55 },
    long_term: { top: 0.75, bottom: 0.55 },
  };

  // Track the highest target score per spotifyId to handle duplicates
  const bestScores = new Map<string, number>();

  for (const timeRange of ['short_term', 'medium_term', 'long_term'] as const) {
    const data = await spotifyFetch<{ items: any[] }>(
      `/me/top/tracks?limit=50&time_range=${timeRange}`,
    );

    if (!data.items || data.items.length === 0) continue;

    const range = scoreRanges[timeRange];
    const count = data.items.length;

    for (let i = 0; i < count; i++) {
      const spotifyId = data.items[i].id;
      // Linear interpolation: rank 0 (top) → range.top, rank count-1 → range.bottom
      const targetScore = count > 1
        ? range.top - (i / (count - 1)) * (range.top - range.bottom)
        : range.top;

      const existing = bestScores.get(spotifyId) ?? 0;
      if (targetScore > existing) {
        bestScores.set(spotifyId, targetScore);
      }
    }
  }

  // Apply preference deltas
  let applied = 0;
  for (const [spotifyId, targetScore] of bestScores) {
    const trackRow = getTrackBySpotifyId(spotifyId);
    if (!trackRow) continue;

    const delta = targetScore - 0.5; // 0.5 is the default neutral score
    updatePreference(trackRow.id, delta);
    applied++;
  }

  setSetting('top_tracks_bootstrapped', 'true');
  logger.info({ applied, total: bestScores.size }, 'Preference bootstrapping complete');
  return true;
}

/**
 * Populate genre_cluster for tracks by fetching artist genres from Spotify.
 * Processes artists in batches of 50.
 */
export async function syncArtistGenres(): Promise<number> {
  logger.info('Syncing artist genres...');
  let totalUpdated = 0;

  while (true) {
    const artistIds = getArtistIdsMissingGenres(50);
    if (artistIds.length === 0) break;

    try {
      const data = await spotifyFetch<{ artists: any[] }>(
        `/artists?ids=${artistIds.join(',')}`,
      );

      if (!data.artists) break;

      for (const artist of data.artists) {
        if (!artist || !artist.genres || artist.genres.length === 0) continue;
        const genre = artist.genres[0]; // Primary genre
        const updated = setGenreClusterByArtist(artist.id, genre);
        totalUpdated += updated;
      }

      logger.debug({ batch: artistIds.length, totalUpdated }, 'Artist genres batch processed');
    } catch (err) {
      if (err instanceof SpotifyApiError && err.statusCode === 403) {
        logger.warn('Artists endpoint returned 403 — skipping genre sync');
        break;
      }
      throw err;
    }
  }

  logger.info({ totalUpdated }, 'Artist genres sync complete');
  return totalUpdated;
}

/**
 * Run a full library sync: saved tracks, top tracks, recently played,
 * audio features, artist genres, and preference bootstrapping.
 */
export async function fullLibrarySync(): Promise<{
  savedTracks: number;
  topTracks: number;
  recentTracks: number;
  audioFeatures: number;
  artistGenres: number;
  preferencesBootstrapped: boolean;
}> {
  logger.info('=== Starting full library sync ===');

  const savedTracks = await syncSavedTracks();
  const topTracks = await syncTopTracks();
  const recentTracks = await syncRecentlyPlayed();
  const audioFeatures = await syncAudioFeatures();
  const artistGenres = await syncArtistGenres();
  const preferencesBootstrapped = await bootstrapPreferencesFromTopTracks();

  logger.info(
    { savedTracks, topTracks, recentTracks, audioFeatures, artistGenres, preferencesBootstrapped },
    '=== Full library sync complete ===',
  );

  return { savedTracks, topTracks, recentTracks, audioFeatures, artistGenres, preferencesBootstrapped };
}
