import type { DatabaseSync } from 'node:sqlite';
import { logger } from '../shared/logger.js';

const CURRENT_VERSION = 1;

/**
 * Run all database migrations.
 */
export function runMigrations(db: DatabaseSync): void {
  const version = getSchemaVersion(db);
  logger.info({ currentVersion: version, targetVersion: CURRENT_VERSION }, 'Checking database schema');

  if (version < 1) {
    migrateV1(db);
  }

  logger.info({ version: CURRENT_VERSION }, 'Database schema up to date');
}

function getSchemaVersion(db: DatabaseSync): number {
  try {
    const result = db.prepare('SELECT version FROM schema_meta LIMIT 1').get() as
      | { version: number }
      | undefined;
    return result?.version ?? 0;
  } catch {
    return 0;
  }
}

function setSchemaVersion(db: DatabaseSync, version: number): void {
  db.prepare('INSERT OR REPLACE INTO schema_meta (rowid, version) VALUES (1, ?)').run(version);
}

function migrateV1(db: DatabaseSync): void {
  logger.info('Running migration v1: initial schema');

  db.exec(`
    -- Schema version tracking
    CREATE TABLE IF NOT EXISTS schema_meta (
      version INTEGER NOT NULL DEFAULT 1
    );

    -- Spotify auth tokens (single row)
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      access_token      TEXT NOT NULL,
      refresh_token     TEXT NOT NULL,
      expires_at        TEXT NOT NULL,
      scope             TEXT,
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    -- Cached track data + audio features
    CREATE TABLE IF NOT EXISTS tracks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      spotify_id        TEXT UNIQUE NOT NULL,
      name              TEXT NOT NULL,
      artist            TEXT NOT NULL,
      artist_id         TEXT,
      album             TEXT,
      album_art_url     TEXT,
      duration_ms       INTEGER NOT NULL,
      energy            REAL,
      valence           REAL,
      tempo             REAL,
      danceability      REAL,
      acousticness      REAL,
      instrumentalness  REAL,
      loudness          REAL,
      speechiness       REAL,
      key               INTEGER,
      mode              INTEGER,
      time_signature    INTEGER,
      genre_cluster     TEXT,
      aggressiveness    REAL,
      familiarity_score REAL DEFAULT 0.5,
      source            TEXT DEFAULT 'library',
      cached_at         TEXT DEFAULT (datetime('now')),
      features_fetched  INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_spotify_id ON tracks(spotify_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre_cluster);
    CREATE INDEX IF NOT EXISTS idx_tracks_energy ON tracks(energy);
    CREATE INDEX IF NOT EXISTS idx_tracks_tempo ON tracks(tempo);

    -- User interactions with tracks
    CREATE TABLE IF NOT EXISTS interactions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id          INTEGER NOT NULL REFERENCES tracks(id),
      session_id        INTEGER REFERENCES sessions(id),
      interaction_type  TEXT NOT NULL,
      listen_duration_ms INTEGER,
      completion_ratio  REAL,
      skip_position_ms  INTEGER,
      created_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_interactions_track ON interactions(track_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_session ON interactions(session_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_type ON interactions(interaction_type);
    CREATE INDEX IF NOT EXISTS idx_interactions_created ON interactions(created_at);

    -- Playback sessions
    CREATE TABLE IF NOT EXISTS sessions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at        TEXT DEFAULT (datetime('now')),
      ended_at          TEXT,
      device_id         TEXT,
      device_name       TEXT,
      track_count       INTEGER DEFAULT 0,
      total_duration_ms INTEGER DEFAULT 0,
      avg_energy        REAL,
      avg_valence       REAL,
      initial_context   TEXT,
      auto_started      INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

    -- Persistent user preference scores per track
    CREATE TABLE IF NOT EXISTS preferences (
      track_id          INTEGER PRIMARY KEY REFERENCES tracks(id),
      score             REAL DEFAULT 0.5,
      play_count        INTEGER DEFAULT 0,
      skip_count        INTEGER DEFAULT 0,
      like_count        INTEGER DEFAULT 0,
      dislike_count     INTEGER DEFAULT 0,
      last_played_at    TEXT,
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    -- State vector snapshots for session visualization
    CREATE TABLE IF NOT EXISTS state_history (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        INTEGER NOT NULL REFERENCES sessions(id),
      track_id          INTEGER REFERENCES tracks(id),
      energy            REAL,
      valence           REAL,
      tempo             REAL,
      genre_cluster     TEXT,
      familiarity       REAL,
      vocalness         REAL,
      aggressiveness    REAL,
      context           TEXT,
      fatigue_level     REAL,
      recorded_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_state_history_session ON state_history(session_id);

    -- Steering control snapshots
    CREATE TABLE IF NOT EXISTS steering_history (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        INTEGER REFERENCES sessions(id),
      energy            REAL,
      mood              REAL,
      familiarity       REAL,
      vocal_vs_instrumental REAL,
      aggressiveness    REAL,
      genre_openness    REAL,
      focus_vs_party    REAL,
      recorded_at       TEXT DEFAULT (datetime('now'))
    );

    -- Time-of-day learned preferences
    CREATE TABLE IF NOT EXISTS time_preferences (
      hour_bracket      TEXT PRIMARY KEY,
      avg_energy        REAL DEFAULT 0.5,
      avg_valence       REAL DEFAULT 0.5,
      avg_tempo         REAL DEFAULT 110,
      avg_familiarity   REAL DEFAULT 0.5,
      avg_vocalness     REAL DEFAULT 0.5,
      avg_aggressiveness REAL DEFAULT 0.3,
      preferred_genres  TEXT,
      sample_count      INTEGER DEFAULT 0,
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    -- Precomputed analytics cache
    CREATE TABLE IF NOT EXISTS analytics_cache (
      key               TEXT PRIMARY KEY,
      value             TEXT NOT NULL,
      computed_at       TEXT DEFAULT (datetime('now')),
      expires_at        TEXT
    );

    -- Application settings
    CREATE TABLE IF NOT EXISTS settings (
      key               TEXT PRIMARY KEY,
      value             TEXT NOT NULL
    );
  `);

  // Insert default settings
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
  );
  insertSetting.run('auto_start_enabled', 'true');
  insertSetting.run('auto_start_delay', '5');
  insertSetting.run('quiet_hours_start', '23');
  insertSetting.run('quiet_hours_end', '7');

  setSchemaVersion(db, 1);
  logger.info('Migration v1 complete');
}
