import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/database/migrations.js';
import { setDbForTesting } from '../../src/database/connection.js';

export function createTestDb(targetVersion?: number): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db, targetVersion);
  setDbForTesting(db);
  return db;
}

export interface TestTrack {
  spotifyId: string;
  name?: string;
  artist?: string;
  artistId?: string | null;
  likedAt?: string | null;
  durationMs?: number;
  energy?: number | null;
  featuresSource?: 'spotify' | 'default' | null;
  genreCluster?: string | null;
  genreSource?: string | null;
}

/** Insert a track row directly. Requires schema v9 for likedAt/featuresSource. */
export function insertTestTrack(db: DatabaseSync, t: TestTrack): number {
  const result = db.prepare(`
    INSERT INTO tracks (spotify_id, name, artist, artist_id, duration_ms, energy,
      features_fetched, genre_cluster, genre_source, liked_at, features_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    t.spotifyId,
    t.name ?? `Track ${t.spotifyId}`,
    t.artist ?? 'Artist',
    t.artistId ?? null,
    t.durationMs ?? 180000,
    t.energy ?? null,
    t.energy != null ? 1 : 0,
    t.genreCluster ?? null,
    t.genreSource ?? null,
    t.likedAt ?? null,
    t.featuresSource ?? null,
  );
  return Number(result.lastInsertRowid);
}
