import { getDb } from '../connection.js';
import type { TrackRow } from '../types.js';

export interface LikedTrackGenreRow {
  id: number;
  spotify_id: string;
  name: string;
  artist: string;
  album_art_url: string | null;
  duration_ms: number;
  liked_at: string;
  energy: number | null;
  genre_cluster: string | null;
  genre_source: string | null;
  /** Comma-joined artist IDs in track order. */
  artist_ids: string | null;
  /** Comma-joined distinct genres across all the track's artists. */
  genres: string | null;
}

/**
 * All liked tracks with their artists and artist genres, newest like first.
 * likedFrom / likedTo are inclusive YYYY-MM-DD dates.
 */
export function getLikedTracksWithGenres(opts: {
  likedFrom?: string | null;
  likedTo?: string | null;
  artistId?: string;
} = {}): LikedTrackGenreRow[] {
  const conditions = ['t.liked_at IS NOT NULL'];
  const params: string[] = [];
  if (opts.likedFrom) {
    conditions.push('t.liked_at >= ?');
    params.push(opts.likedFrom);
  }
  if (opts.likedTo) {
    conditions.push("t.liked_at < date(?, '+1 day')");
    params.push(opts.likedTo);
  }
  if (opts.artistId) {
    conditions.push('EXISTS (SELECT 1 FROM track_artists x WHERE x.track_id = t.id AND x.artist_id = ?)');
    params.push(opts.artistId);
  }

  return getDb().prepare(`
    SELECT t.id, t.spotify_id, t.name, t.artist, t.album_art_url, t.duration_ms, t.liked_at,
           t.energy, t.genre_cluster, t.genre_source,
           (SELECT group_concat(artist_id, ',')
              FROM (SELECT artist_id FROM track_artists WHERE track_id = t.id ORDER BY position)) AS artist_ids,
           (SELECT group_concat(DISTINCT ag.genre)
              FROM track_artists ta JOIN artist_genres ag ON ag.artist_id = ta.artist_id
             WHERE ta.track_id = t.id) AS genres
    FROM tracks t
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.liked_at DESC, t.id DESC
  `).all(...params) as unknown as LikedTrackGenreRow[];
}

export function getArtistNameMap(): Map<string, string> {
  const rows = getDb().prepare('SELECT artist_id, name FROM artists').all() as { artist_id: string; name: string }[];
  return new Map(rows.map((r) => [r.artist_id, r.name]));
}

/**
 * Artists appearing on liked tracks whose name contains `q` (case-insensitive).
 */
export function searchLikedArtists(q: string, limit: number = 20): { artistId: string; name: string; trackCount: number }[] {
  return getDb().prepare(`
    SELECT a.artist_id AS artistId, a.name AS name, COUNT(DISTINCT t.id) AS trackCount
    FROM artists a
    JOIN track_artists ta ON ta.artist_id = a.artist_id
    JOIN tracks t ON t.id = ta.track_id AND t.liked_at IS NOT NULL
    WHERE LOWER(a.name) LIKE ?
    GROUP BY a.artist_id
    ORDER BY trackCount DESC, a.name
    LIMIT ?
  `).all(`%${q.toLowerCase()}%`, limit) as { artistId: string; name: string; trackCount: number }[];
}

export function likedArtistExists(artistId: string): boolean {
  const row = getDb().prepare(`
    SELECT 1 FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
    WHERE ta.artist_id = ? AND t.liked_at IS NOT NULL LIMIT 1
  `).get(artistId);
  return row != null;
}

/** Tracks by internal ID (any order). Uses json_each to avoid variable limits. */
export function getTracksByIds(ids: number[]): TrackRow[] {
  if (ids.length === 0) return [];
  return getDb().prepare(
    'SELECT * FROM tracks WHERE id IN (SELECT value FROM json_each(?))',
  ).all(JSON.stringify(ids)) as unknown as TrackRow[];
}

export function hasRealFeatures(): boolean {
  const row = getDb().prepare(
    "SELECT 1 FROM tracks WHERE liked_at IS NOT NULL AND features_source = 'spotify' LIMIT 1",
  ).get();
  return row != null;
}
