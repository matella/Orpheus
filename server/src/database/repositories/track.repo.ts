import { getDb } from '../connection.js';
import type { TrackRow } from '../types.js';

export interface UpsertTrackData {
  spotifyId: string;
  name: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumArtUrl?: string;
  durationMs: number;
  source?: string;
}

export interface UpsertAudioFeatures {
  spotifyId: string;
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

/**
 * Upsert a track into the database. Returns the track's internal ID.
 */
export function upsertTrack(data: UpsertTrackData): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO tracks (spotify_id, name, artist, artist_id, album, album_art_url, duration_ms, source, cached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(spotify_id) DO UPDATE SET
      name = excluded.name,
      artist = excluded.artist,
      artist_id = excluded.artist_id,
      album = excluded.album,
      album_art_url = excluded.album_art_url,
      duration_ms = excluded.duration_ms,
      cached_at = datetime('now')
  `).run(
    data.spotifyId,
    data.name,
    data.artist,
    data.artistId ?? null,
    data.album ?? null,
    data.albumArtUrl ?? null,
    data.durationMs,
    data.source ?? 'library',
  );

  // Get the ID of the upserted row
  const row = db.prepare('SELECT id FROM tracks WHERE spotify_id = ?').get(data.spotifyId) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`Track not found after upsert: ${data.spotifyId}`);
  return row.id;
}

/**
 * Batch upsert tracks. More efficient for large imports.
 */
export function upsertTracks(tracks: UpsertTrackData[]): void {
  const db = getDb();

  db.prepare('SAVEPOINT upsert_tracks').run();
  try {
    const stmt = db.prepare(`
      INSERT INTO tracks (spotify_id, name, artist, artist_id, album, album_art_url, duration_ms, source, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(spotify_id) DO UPDATE SET
        name = excluded.name,
        artist = excluded.artist,
        artist_id = excluded.artist_id,
        album = excluded.album,
        album_art_url = excluded.album_art_url,
        duration_ms = excluded.duration_ms,
        cached_at = datetime('now')
    `);

    for (const t of tracks) {
      stmt.run(
        t.spotifyId,
        t.name,
        t.artist,
        t.artistId ?? null,
        t.album ?? null,
        t.albumArtUrl ?? null,
        t.durationMs,
        t.source ?? 'library',
      );
    }
    db.prepare('RELEASE upsert_tracks').run();
  } catch (err) {
    db.prepare('ROLLBACK TO upsert_tracks').run();
    throw err;
  }
}

/**
 * Update audio features for a track.
 */
export function updateAudioFeatures(features: UpsertAudioFeatures): void {
  const db = getDb();
  // Derive aggressiveness from energy and loudness
  const aggressiveness = Math.min(1, (features.energy * 0.6 + (1 - Math.abs(features.loudness) / 60) * 0.4));

  db.prepare(`
    UPDATE tracks SET
      energy = ?,
      valence = ?,
      tempo = ?,
      danceability = ?,
      acousticness = ?,
      instrumentalness = ?,
      loudness = ?,
      speechiness = ?,
      key = ?,
      mode = ?,
      time_signature = ?,
      aggressiveness = ?,
      features_fetched = 1
    WHERE spotify_id = ?
  `).run(
    features.energy,
    features.valence,
    features.tempo,
    features.danceability,
    features.acousticness,
    features.instrumentalness,
    features.loudness,
    features.speechiness,
    features.key,
    features.mode,
    features.timeSignature,
    aggressiveness,
    features.spotifyId,
  );
}

/**
 * Batch update audio features.
 */
export function updateAudioFeaturesBatch(featuresList: UpsertAudioFeatures[]): void {
  for (const f of featuresList) {
    updateAudioFeatures(f);
  }
}

/**
 * Get a track by its Spotify ID.
 */
export function getTrackBySpotifyId(spotifyId: string): TrackRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tracks WHERE spotify_id = ?').get(spotifyId) as
    | TrackRow
    | undefined;
  return row ?? null;
}

/**
 * Get a track by internal ID.
 */
export function getTrackById(id: number): TrackRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined;
  return row ?? null;
}

/**
 * Get all tracks with audio features loaded.
 */
export function getTracksWithFeatures(limit?: number): TrackRow[] {
  const db = getDb();
  const sql = limit
    ? 'SELECT * FROM tracks WHERE features_fetched = 1 ORDER BY cached_at DESC LIMIT ?'
    : 'SELECT * FROM tracks WHERE features_fetched = 1 ORDER BY cached_at DESC';
  return (limit ? db.prepare(sql).all(limit) : db.prepare(sql).all()) as unknown as TrackRow[];
}

/**
 * Get Spotify IDs of tracks missing audio features.
 */
export function getTracksMissingFeatures(limit: number = 100): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT spotify_id FROM tracks WHERE features_fetched = 0 LIMIT ?',
  ).all(limit) as { spotify_id: string }[];
  return rows.map((r) => r.spotify_id);
}

/**
 * Get total track count and breakdown.
 */
export function getTrackStats(): {
  total: number;
  withFeatures: number;
  bySource: Record<string, number>;
} {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as count FROM tracks').get() as { count: number }).count;
  const withFeatures = (db.prepare('SELECT COUNT(*) as count FROM tracks WHERE features_fetched = 1').get() as { count: number }).count;
  const sourceRows = db.prepare(
    'SELECT source, COUNT(*) as count FROM tracks GROUP BY source',
  ).all() as { source: string; count: number }[];

  const bySource: Record<string, number> = {};
  for (const row of sourceRows) {
    bySource[row.source] = row.count;
  }

  return { total, withFeatures, bySource };
}

/**
 * Get genre distribution for tracks with features.
 */
export function getGenreDistribution(): { genre: string; count: number }[] {
  const db = getDb();
  return db.prepare(`
    SELECT genre_cluster as genre, COUNT(*) as count
    FROM tracks
    WHERE genre_cluster IS NOT NULL
    GROUP BY genre_cluster
    ORDER BY count DESC
  `).all() as { genre: string; count: number }[];
}

/**
 * Get a random sample of tracks with features.
 */
export function getRandomTracks(limit: number, excludeIds?: Set<number>): TrackRow[] {
  const db = getDb();
  if (excludeIds && excludeIds.size > 0) {
    const ids = [...excludeIds];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(
      `SELECT * FROM tracks WHERE features_fetched = 1 AND id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT ?`,
    ).all(...ids, limit) as unknown as TrackRow[];
  }
  return db.prepare(
    'SELECT * FROM tracks WHERE features_fetched = 1 ORDER BY RANDOM() LIMIT ?',
  ).all(limit) as unknown as TrackRow[];
}

/**
 * Get distinct artist IDs for tracks that don't have a genre_cluster set.
 */
export function getArtistIdsMissingGenres(limit: number = 50): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT DISTINCT artist_id FROM tracks WHERE artist_id IS NOT NULL AND genre_cluster IS NULL LIMIT ?',
  ).all(limit) as { artist_id: string }[];
  return rows.map((r) => r.artist_id);
}

/**
 * Set genre_cluster for all tracks by a given artist (only where genre is currently NULL).
 */
export function setGenreClusterByArtist(artistId: string, genre: string): number {
  const db = getDb();
  const result = db.prepare(
    'UPDATE tracks SET genre_cluster = ? WHERE artist_id = ? AND genre_cluster IS NULL',
  ).run(genre, artistId);
  return Number(result.changes);
}

/**
 * Mark all unfetched tracks with neutral default audio features.
 * Used when Spotify's audio-features endpoint is unavailable (403).
 * Returns the number of tracks updated.
 */
export function markTracksWithDefaultFeatures(): number {
  const db = getDb();
  const result = db.prepare(`
    UPDATE tracks SET
      energy = 0.5,
      valence = 0.5,
      tempo = 120,
      danceability = 0.5,
      acousticness = 0.5,
      instrumentalness = 0.1,
      loudness = -10,
      speechiness = 0.1,
      key = 0,
      mode = 1,
      time_signature = 4,
      aggressiveness = 0.5,
      features_fetched = 1
    WHERE features_fetched = 0
  `).run();
  return Number(result.changes);
}

// ── Library Search ───────────────────────────────────────────────

export interface LibrarySearchParams {
  artists: string[];
  genres: string[];
  moods: string[];
  limit: number;
}

/**
 * Search the local track library using multiple criteria.
 * Uses LIKE for fuzzy matching on artist/genre, and feature ranges for moods.
 */
export function searchLibraryTracks(params: LibrarySearchParams): TrackRow[] {
  const db = getDb();
  const conditions: string[] = ['features_fetched = 1'];
  const bindings: (string | number)[] = [];

  // Artist filter (OR across artists, LIKE match)
  if (params.artists.length > 0) {
    const clauses = params.artists.map(() => 'LOWER(artist) LIKE ?');
    conditions.push(`(${clauses.join(' OR ')})`);
    for (const a of params.artists) {
      bindings.push(`%${a.toLowerCase()}%`);
    }
  }

  // Genre filter (OR across genres, LIKE match on genre_cluster)
  if (params.genres.length > 0) {
    const clauses = params.genres.map(() => 'LOWER(genre_cluster) LIKE ?');
    conditions.push(`(${clauses.join(' OR ')})`);
    for (const g of params.genres) {
      bindings.push(`%${g.toLowerCase()}%`);
    }
  }

  // Mood-to-feature mapping
  if (params.moods.length > 0) {
    const moodConditions = mapMoodsToFeatureConditions(params.moods);
    if (moodConditions.length > 0) {
      conditions.push(`(${moodConditions.join(' AND ')})`);
    }
  }

  const sql = `
    SELECT * FROM tracks
    WHERE ${conditions.join(' AND ')}
    ORDER BY RANDOM()
    LIMIT ?
  `;
  bindings.push(params.limit);

  return db.prepare(sql).all(...bindings) as unknown as TrackRow[];
}

function mapMoodsToFeatureConditions(moods: string[]): string[] {
  const conditions: string[] = [];

  for (const mood of moods) {
    switch (mood.toLowerCase()) {
      case 'chill':
      case 'relaxed':
      case 'calm':
      case 'mellow':
      case 'peaceful':
        conditions.push('energy < 0.45');
        break;
      case 'energetic':
      case 'hype':
      case 'upbeat':
      case 'pump':
        conditions.push('energy > 0.65');
        break;
      case 'happy':
      case 'bright':
      case 'cheerful':
        conditions.push('valence > 0.6');
        break;
      case 'sad':
      case 'melancholy':
      case 'somber':
        conditions.push('valence < 0.35');
        break;
      case 'aggressive':
      case 'angry':
      case 'hard':
        conditions.push('energy > 0.7');
        conditions.push('aggressiveness > 0.6');
        break;
      case 'focus':
      case 'study':
        conditions.push('energy BETWEEN 0.2 AND 0.55');
        conditions.push('instrumentalness > 0.3');
        break;
      case 'party':
      case 'dance':
        conditions.push('danceability > 0.65');
        conditions.push('energy > 0.6');
        break;
    }
  }

  return conditions;
}
