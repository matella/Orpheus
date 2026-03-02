import { getDb } from '../connection.js';
import type { SpotifyTopArtistRow } from '../types.js';

export interface UpsertTopArtistData {
  spotifyId: string;
  name: string;
  genres: string[];
  popularity: number;
  imageUrl: string | null;
  rank: number;
}

/**
 * Replace all top artists for a given time range (full refresh).
 */
export function upsertTopArtists(timeRange: string, artists: UpsertTopArtistData[]): void {
  const db = getDb();

  // Wrap in savepoint so a crash mid-insert doesn't leave the table
  // with old data deleted and only partial new data inserted.
  db.prepare('SAVEPOINT upsert_artists').run();
  try {
    db.prepare('DELETE FROM spotify_top_artists WHERE time_range = ?').run(timeRange);

    const insert = db.prepare(`
      INSERT INTO spotify_top_artists (spotify_id, name, genres, popularity, image_url, time_range, rank, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    for (const artist of artists) {
      insert.run(
        artist.spotifyId,
        artist.name,
        JSON.stringify(artist.genres),
        artist.popularity,
        artist.imageUrl,
        timeRange,
        artist.rank,
      );
    }
    db.prepare('RELEASE upsert_artists').run();
  } catch (err) {
    db.prepare('ROLLBACK TO upsert_artists').run();
    throw err;
  }
}

/**
 * Get top artists for a specific time range.
 */
export function getTopArtists(timeRange: string, limit: number = 50): SpotifyTopArtistRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM spotify_top_artists WHERE time_range = ? ORDER BY rank ASC LIMIT ?',
  ).all(timeRange, limit) as unknown as SpotifyTopArtistRow[];
}

/**
 * Get top artist names for a time range.
 */
export function getTopArtistNames(timeRange: string, limit: number = 10): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT name FROM spotify_top_artists WHERE time_range = ? ORDER BY rank ASC LIMIT ?',
  ).all(timeRange, limit) as { name: string }[];
  return rows.map((r) => r.name);
}

/**
 * Aggregate genre distribution across all top artists.
 * Parses the JSON genres array for each artist and counts occurrences.
 */
export function getTopArtistGenreDistribution(): { genre: string; count: number }[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT genres FROM spotify_top_artists WHERE genres IS NOT NULL',
  ).all() as { genres: string }[];

  const counts = new Map<string, number>();
  for (const row of rows) {
    try {
      const genres = JSON.parse(row.genres) as string[];
      for (const genre of genres) {
        counts.set(genre, (counts.get(genre) ?? 0) + 1);
      }
    } catch {
      // Skip malformed JSON
    }
  }

  return [...counts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count);
}
