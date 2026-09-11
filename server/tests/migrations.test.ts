import { describe, it, expect } from 'vitest';
import { createTestDb } from './helpers/db.js';
import { runMigrations } from '../src/database/migrations.js';

function columns(db: ReturnType<typeof createTestDb>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe('migration v9', () => {
  it('adds liked_at, features_source and the artist tables', () => {
    const db = createTestDb();
    expect(columns(db, 'tracks')).toEqual(expect.arrayContaining(['liked_at', 'features_source']));
    expect(columns(db, 'artists')).toEqual(['artist_id', 'name', 'genres_fetched_at']);
    expect(columns(db, 'artist_genres')).toEqual(['artist_id', 'genre']);
    expect(columns(db, 'track_artists')).toEqual(['track_id', 'artist_id', 'position']);
    expect((db.prepare('SELECT version FROM schema_meta').get() as { version: number }).version).toBe(9);
  });

  it('backfills a v8 database', () => {
    const db = createTestDb(8);
    const insert = db.prepare(`
      INSERT INTO tracks (spotify_id, name, artist, artist_id, duration_ms, features_fetched,
        energy, valence, tempo, danceability, acousticness, instrumentalness, loudness, speechiness)
      VALUES (?, ?, ?, ?, 1000, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Neutral defaults written by markTracksWithDefaultFeatures()
    insert.run('def', 'Default', 'aespa', 'a1', 0.5, 0.5, 120, 0.5, 0.5, 0.1, -10, 0.1);
    // Real Spotify features
    insert.run('real', 'Real', 'Tyler, The Creator, Kali Uchis', 'a2', 0.8, 0.3, 98, 0.7, 0.1, 0, -5, 0.2);

    runMigrations(db);

    const src = db.prepare('SELECT spotify_id, features_source FROM tracks ORDER BY spotify_id').all();
    expect(src).toEqual([
      { spotify_id: 'def', features_source: 'default' },
      { spotify_id: 'real', features_source: 'spotify' },
    ]);
    const ta = db.prepare('SELECT artist_id, position FROM track_artists ORDER BY artist_id').all();
    expect(ta).toEqual([{ artist_id: 'a1', position: 0 }, { artist_id: 'a2', position: 0 }]);
    const artists = db.prepare('SELECT artist_id, name, genres_fetched_at FROM artists ORDER BY artist_id').all();
    expect(artists).toEqual([
      { artist_id: 'a1', name: 'aespa', genres_fetched_at: null },
      { artist_id: 'a2', name: 'Tyler', genres_fetched_at: null },
    ]);
  });

  it('is idempotent', () => {
    const db = createTestDb();
    expect(() => runMigrations(db)).not.toThrow();
  });
});
