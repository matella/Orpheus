import { getDb } from '../connection.js';

export interface ArtistRef {
  id: string;
  name: string;
}

/**
 * Insert artists or refresh their names. Never touches genres_fetched_at.
 */
export function upsertArtistNames(artists: ArtistRef[]): void {
  const stmt = getDb().prepare(`
    INSERT INTO artists (artist_id, name) VALUES (?, ?)
    ON CONFLICT(artist_id) DO UPDATE SET name = excluded.name
  `);
  for (const a of artists) stmt.run(a.id, a.name);
}

/**
 * Replace the artist list of a track. Position = index in the array.
 */
export function setTrackArtists(trackId: number, artistIds: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM track_artists WHERE track_id = ?').run(trackId);
  const stmt = db.prepare('INSERT OR IGNORE INTO track_artists (track_id, artist_id, position) VALUES (?, ?, ?)');
  artistIds.forEach((id, i) => stmt.run(trackId, id, i));
}

/**
 * Ensure every track's primary artist exists in `artists` / `track_artists`.
 * Covers tracks added by top-tracks, recently-played, and search syncs.
 */
export function backfillPrimaryArtists(): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO artists (artist_id, name)
    SELECT artist_id,
           TRIM(CASE WHEN instr(artist, ',') > 0 THEN substr(artist, 1, instr(artist, ',') - 1) ELSE artist END)
    FROM tracks WHERE artist_id IS NOT NULL
    GROUP BY artist_id
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO track_artists (track_id, artist_id, position)
    SELECT t.id, t.artist_id, 0 FROM tracks t
    WHERE t.artist_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM track_artists ta WHERE ta.track_id = t.id)
  `).run();
}

/**
 * Artists whose genres were never fetched — artists of liked tracks first.
 */
export function getArtistsNeedingGenres(limit: number): string[] {
  const rows = getDb().prepare(`
    SELECT a.artist_id,
           EXISTS (
             SELECT 1 FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
             WHERE ta.artist_id = a.artist_id AND t.liked_at IS NOT NULL
           ) AS liked
    FROM artists a
    WHERE a.genres_fetched_at IS NULL
    ORDER BY liked DESC, a.artist_id
    LIMIT ?
  `).all(limit) as { artist_id: string }[];
  return rows.map((r) => r.artist_id);
}

/**
 * Replace an artist's genres and mark it fetched (also when genres is empty).
 */
export function saveArtistGenres(artistId: string, name: string | null, genres: string[]): void {
  const db = getDb();
  db.prepare('SAVEPOINT save_artist_genres').run();
  try {
    db.prepare('DELETE FROM artist_genres WHERE artist_id = ?').run(artistId);
    const insert = db.prepare('INSERT OR IGNORE INTO artist_genres (artist_id, genre) VALUES (?, ?)');
    for (const g of genres) insert.run(artistId, g.toLowerCase());
    db.prepare(`
      UPDATE artists SET genres_fetched_at = datetime('now'), name = COALESCE(?, name)
      WHERE artist_id = ?
    `).run(name, artistId);
    db.prepare('RELEASE save_artist_genres').run();
  } catch (err) {
    db.prepare('ROLLBACK TO save_artist_genres').run();
    throw err;
  }
}

/**
 * Genre-sync progress over artists that appear on liked tracks.
 */
export function getGenreSyncCounts(): { done: number; total: number } {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(a.genres_fetched_at IS NOT NULL), 0) AS done
    FROM artists a
    WHERE EXISTS (
      SELECT 1 FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
      WHERE ta.artist_id = a.artist_id AND t.liked_at IS NOT NULL
    )
  `).get() as { total: number; done: number };
  return { done: row.done, total: row.total };
}
