import { spotifyFetch } from './client.js';
import { runArtistGenreSync } from './artist-genre-sync.js';
import { SpotifyApiError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import {
  AUDIO_FEATURES_BATCH_SIZE,
  LEARNING,
  TOP_TRACK_NUDGE_FACTOR,
  TOP_TRACK_NUDGE_MIN_THRESHOLD,
} from '../shared/constants.js';
import {
  upsertTracks,
  updateAudioFeaturesBatch,
  getTracksMissingFeatures,
  markTracksWithDefaultFeatures,
  getTrackBySpotifyId,
  upsertLikedTracks,
  clearUnlikedTracks,
  type UpsertTrackData,
  type UpsertAudioFeatures,
  type LikedTrackData,
} from '../database/repositories/track.repo.js';
import { getSetting, setSetting } from '../database/repositories/settings.repo.js';
import { recordInteraction } from '../database/repositories/interaction.repo.js';
import { recordPlay, updatePreference, getPreferenceScore } from '../database/repositories/preference.repo.js';
import { upsertTopArtists, type UpsertTopArtistData } from '../database/repositories/top-artists.repo.js';
import { learnFromExternalPlay } from '../intelligence/context-learning.js';

/**
 * Sync all saved tracks (Liked Songs) from the user's Spotify library.
 * Records liked dates and every artist. After a complete pass, tracks no
 * longer liked get liked_at = NULL.
 */
export async function syncSavedTracks(): Promise<number> {
  logger.info('Starting saved tracks sync...');
  let total = 0;
  let offset = 0;
  const limit = 50; // Spotify max per page
  const seen: string[] = [];
  let reportedTotal: number | null = null;
  let received = 0;

  while (true) {
    const data = await spotifyFetch<{
      items: any[];
      total: number;
      next: string | null;
    }>(`/me/tracks?limit=${limit}&offset=${offset}`);

    reportedTotal = data.total;

    if (!data.items || data.items.length === 0) break;

    received += data.items.length;

    const tracks: LikedTrackData[] = data.items
      .filter((item: any) => item.track?.id)
      .map((item: any) => ({
        spotifyId: item.track.id,
        name: item.track.name,
        artist: item.track.artists.map((a: any) => a.name).join(', '),
        artistId: item.track.artists[0]?.id ?? undefined,
        album: item.track.album?.name,
        albumArtUrl: item.track.album?.images?.[0]?.url,
        durationMs: item.track.duration_ms,
        source: 'library',
        likedAt: item.added_at,
        artists: item.track.artists
          .filter((a: any) => a.id)
          .map((a: any) => ({ id: a.id, name: a.name })),
      }));

    upsertLikedTracks(tracks);
    for (const t of tracks) seen.push(t.spotifyId);
    total += tracks.length;
    offset += limit;

    logger.debug({ synced: total, libraryTotal: data.total }, 'Syncing saved tracks...');

    if (!data.next) break;
  }

  // Only sweep after a complete pass: a short or empty pass (API glitch)
  // must never clear liked flags.
  let unliked = 0;
  if (reportedTotal !== null && received >= reportedTotal) {
    unliked = clearUnlikedTracks(seen);
  } else {
    logger.warn({ received, seen: seen.length, reportedTotal }, 'Saved tracks pass incomplete — skipping un-like sweep');
  }
  logger.info({ total, unliked }, 'Saved tracks sync complete');
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

    // External plays get the same preference boost as completed Orpheus plays
    updatePreference(trackRow.id, LEARNING.completionPositive);

    // Learn time-of-day patterns from external plays
    learnFromExternalPlay(trackRow, playedAt);

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
          'Audio features endpoint returned 403 -- Spotify restricts this for new apps. ' +
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
 * Populate artist genres (all genres, per artist) and tracks.genre_cluster.
 * Bounded to 4 minutes per call so the scheduler's 5-minute task timeout
 * is never hit; the remainder resumes on the next run.
 */
export async function syncArtistGenres(): Promise<number> {
  return runArtistGenreSync({ maxDurationMs: 4 * 60 * 1000 });
}

/**
 * Sync the user's top artists from Spotify (short, medium, and long term).
 * Stores in spotify_top_artists table with full genre data.
 */
export async function syncTopArtists(): Promise<number> {
  logger.info('Starting top artists sync...');
  let total = 0;

  for (const timeRange of ['short_term', 'medium_term', 'long_term'] as const) {
    try {
      const data = await spotifyFetch<{ items: any[] }>(
        `/me/top/artists?limit=50&time_range=${timeRange}`,
      );

      if (!data.items || data.items.length === 0) continue;

      const artists: UpsertTopArtistData[] = data.items.map((item: any, index: number) => ({
        spotifyId: item.id,
        name: item.name,
        genres: item.genres ?? [],
        popularity: item.popularity ?? 0,
        imageUrl: item.images?.[0]?.url ?? null,
        rank: index,
      }));

      upsertTopArtists(timeRange, artists);
      total += artists.length;
      logger.debug({ timeRange, count: artists.length }, 'Synced top artists');
    } catch (err) {
      if (err instanceof SpotifyApiError && err.statusCode === 403) {
        logger.warn('Top artists endpoint returned 403 -- skipping');
        break;
      }
      throw err;
    }
  }

  logger.info({ total }, 'Top artists sync complete');
  return total;
}

/**
 * Continuously refresh preference scores from Spotify top track rankings.
 * Unlike bootstrapPreferencesFromTopTracks (one-time), this runs every sync
 * and applies a fractional nudge toward the ranking-based target score.
 */
export async function refreshPreferencesFromTopTracks(): Promise<number> {
  logger.info('Refreshing preferences from top tracks...');

  const scoreRanges: Record<string, { top: number; bottom: number }> = {
    short_term: { top: 0.85, bottom: 0.55 },
    medium_term: { top: 0.80, bottom: 0.55 },
    long_term: { top: 0.75, bottom: 0.55 },
  };

  // Build best-target map across all time ranges
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
      const targetScore = count > 1
        ? range.top - (i / (count - 1)) * (range.top - range.bottom)
        : range.top;

      const existing = bestScores.get(spotifyId) ?? 0;
      if (targetScore > existing) {
        bestScores.set(spotifyId, targetScore);
      }
    }
  }

  // Apply fractional nudge toward target
  let applied = 0;
  for (const [spotifyId, targetScore] of bestScores) {
    const trackRow = getTrackBySpotifyId(spotifyId);
    if (!trackRow) continue;

    const currentScore = getPreferenceScore(trackRow.id);
    const gap = targetScore - currentScore;
    const nudge = gap * TOP_TRACK_NUDGE_FACTOR;

    if (Math.abs(nudge) > TOP_TRACK_NUDGE_MIN_THRESHOLD) {
      updatePreference(trackRow.id, nudge);
      applied++;
    }
  }

  logger.info({ applied, total: bestScores.size }, 'Top tracks preference refresh complete');
  return applied;
}

/**
 * Get track recommendations from Spotify using seed tracks/artists/genres.
 * Upserts results into the local DB and returns TrackRow objects.
 * Handles 403 gracefully (some apps are restricted from this endpoint).
 */
export async function getSpotifyRecommendations(params: {
  seedTracks?: string[];
  seedArtists?: string[];
  seedGenres?: string[];
  targetEnergy?: number;
  targetValence?: number;
  targetTempo?: number;
  limit?: number;
}): Promise<import('../database/types.js').TrackRow[]> {
  const query = new URLSearchParams();

  // Spotify requires at least 1 seed, max 5 total across all types
  const seedTracks = (params.seedTracks ?? []).slice(0, 5);
  const seedArtists = (params.seedArtists ?? []).slice(0, Math.max(0, 5 - seedTracks.length));
  const seedGenres = (params.seedGenres ?? []).slice(0, Math.max(0, 5 - seedTracks.length - seedArtists.length));

  if (seedTracks.length === 0 && seedArtists.length === 0 && seedGenres.length === 0) {
    logger.debug('No seeds provided for recommendations');
    return [];
  }

  if (seedTracks.length > 0) query.set('seed_tracks', seedTracks.join(','));
  if (seedArtists.length > 0) query.set('seed_artists', seedArtists.join(','));
  if (seedGenres.length > 0) query.set('seed_genres', seedGenres.join(','));
  if (params.targetEnergy != null) query.set('target_energy', String(params.targetEnergy));
  if (params.targetValence != null) query.set('target_valence', String(params.targetValence));
  if (params.targetTempo != null) query.set('target_tempo', String(params.targetTempo));
  query.set('limit', String(Math.min(params.limit ?? 20, 100)));

  try {
    const data = await spotifyFetch<{ tracks: any[] }>(`/recommendations?${query.toString()}`);

    if (!data.tracks || data.tracks.length === 0) return [];

    const tracks: UpsertTrackData[] = data.tracks.map((item: any) => ({
      spotifyId: item.id,
      name: item.name,
      artist: item.artists.map((a: any) => a.name).join(', '),
      artistId: item.artists[0]?.id ?? undefined,
      album: item.album?.name,
      albumArtUrl: item.album?.images?.[0]?.url,
      durationMs: item.duration_ms,
      source: 'search',
    }));

    upsertTracks(tracks);

    // Return full TrackRow objects from DB
    const results: import('../database/types.js').TrackRow[] = [];
    for (const t of tracks) {
      const row = getTrackBySpotifyId(t.spotifyId);
      if (row) results.push(row);
    }

    logger.info({ seedCount: seedTracks.length + seedArtists.length + seedGenres.length, results: results.length }, 'Spotify recommendations fetched');
    return results;
  } catch (err) {
    if (err instanceof SpotifyApiError && err.statusCode === 403) {
      logger.warn('Recommendations endpoint returned 403 -- Spotify restricts this for some apps');
      return [];
    }
    logger.warn({ err }, 'Spotify recommendations failed');
    return [];
  }
}

/**
 * Run a full library sync: saved tracks, top tracks, top artists,
 * recently played, audio features, artist genres, and preference management.
 */
export async function fullLibrarySync(): Promise<{
  savedTracks: number;
  topTracks: number;
  topArtists: number;
  recentTracks: number;
  audioFeatures: number;
  artistGenres: number;
  preferencesBootstrapped: boolean;
  preferencesRefreshed: number;
}> {
  logger.info('=== Starting full library sync ===');

  const savedTracks = await syncSavedTracks();
  const topTracks = await syncTopTracks();
  const topArtists = await syncTopArtists();
  const recentTracks = await syncRecentlyPlayed();
  const audioFeatures = await syncAudioFeatures();
  const artistGenres = await syncArtistGenres();
  const preferencesBootstrapped = await bootstrapPreferencesFromTopTracks();
  const preferencesRefreshed = await refreshPreferencesFromTopTracks();

  logger.info(
    { savedTracks, topTracks, topArtists, recentTracks, audioFeatures, artistGenres, preferencesBootstrapped, preferencesRefreshed },
    '=== Full library sync complete ===',
  );

  return { savedTracks, topTracks, topArtists, recentTracks, audioFeatures, artistGenres, preferencesBootstrapped, preferencesRefreshed };
}
