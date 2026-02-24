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
  return row!.id;
}

/**
 * Batch upsert tracks. More efficient for large imports.
 */
export function upsertTracks(tracks: UpsertTrackData[]): void {
  const db = getDb();
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
  return (limit ? db.prepare(sql).all(limit) : db.prepare(sql).all()) as TrackRow[];
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
export function getRandomTracks(limit: number): TrackRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM tracks WHERE features_fetched = 1 ORDER BY RANDOM() LIMIT ?',
  ).all(limit) as TrackRow[];
}
