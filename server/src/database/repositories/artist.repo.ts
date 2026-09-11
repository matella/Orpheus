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
