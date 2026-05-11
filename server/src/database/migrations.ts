import type { DatabaseSync } from 'node:sqlite';
import { logger } from '../shared/logger.js';

const CURRENT_VERSION = 8;

/**
 * Run all database migrations.
 */
export function runMigrations(db: DatabaseSync): void {
  const version = getSchemaVersion(db);
  logger.info({ currentVersion: version, targetVersion: CURRENT_VERSION }, 'Checking database schema');

  if (version < 1) {
    migrateV1(db);
  }

  if (version < 2) {
    migrateV2(db);
  }

  if (version < 3) {
    migrateV3(db);
  }

  if (version < 4) {
    migrateV4(db);
  }

  if (version < 5) {
    migrateV5(db);
  }

  if (version < 6) {
    migrateV6(db);
  }

  if (version < 7) {
    migrateV7(db);
  }

  if (version < 8) {
    migrateV8(db);
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

function migrateV2(db: DatabaseSync): void {
  logger.info('Running migration v2: AI suggestions');

  db.exec(`
    -- AI suggestion history
    CREATE TABLE IF NOT EXISTS ai_suggestions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        INTEGER REFERENCES sessions(id),
      suggestion_type   TEXT NOT NULL,
      prompt            TEXT NOT NULL,
      response          TEXT NOT NULL,
      applied           INTEGER DEFAULT 0,
      created_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ai_suggestions_session ON ai_suggestions(session_id);
    CREATE INDEX IF NOT EXISTS idx_ai_suggestions_type ON ai_suggestions(suggestion_type);
  `);

  // Seed AI settings
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
  );
  insertSetting.run('ai_enabled', 'true');
  insertSetting.run('ai_analysis_interval', '5');

  setSchemaVersion(db, 2);
  logger.info('Migration v2 complete');
}

function migrateV3(db: DatabaseSync): void {
  logger.info('Running migration v3: AI reasoning layer');

  // ALTER TABLE is not idempotent — check if column already exists before adding.
  // This prevents a crash if V3 ran partially (column added but version not bumped).
  const columns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
  const hasSessionName = columns.some((c) => c.name === 'session_name');
  if (!hasSessionName) {
    db.prepare('ALTER TABLE sessions ADD COLUMN session_name TEXT').run();
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS monthly_recaps (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      year        INTEGER NOT NULL,
      month       INTEGER NOT NULL,
      recap       TEXT NOT NULL,
      stats       TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(year, month)
    )
  `).run();

  setSchemaVersion(db, 3);
  logger.info('Migration v3 complete');
}

function migrateV4(db: DatabaseSync): void {
  logger.info('Running migration v4: Spotify listening data integration');

  db.exec(`
    -- Top artists synced from Spotify across time ranges
    CREATE TABLE IF NOT EXISTS spotify_top_artists (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      spotify_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      genres      TEXT,
      popularity  INTEGER,
      image_url   TEXT,
      time_range  TEXT NOT NULL,
      rank        INTEGER NOT NULL,
      synced_at   TEXT DEFAULT (datetime('now')),
      UNIQUE(spotify_id, time_range)
    );

    CREATE INDEX IF NOT EXISTS idx_top_artists_time_range ON spotify_top_artists(time_range);
    CREATE INDEX IF NOT EXISTS idx_top_artists_rank ON spotify_top_artists(rank);

    -- Precomputed aggregate listening stats
    CREATE TABLE IF NOT EXISTS spotify_listening_stats (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      computed_at TEXT DEFAULT (datetime('now'))
    );
  `);

  setSchemaVersion(db, 4);
  logger.info('Migration v4 complete');
}

function migrateV5(db: DatabaseSync): void {
  logger.info('Running migration v5: playlist generation');

  db.exec(`
    -- Generated playlists
    CREATE TABLE IF NOT EXISTS playlists (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt                TEXT NOT NULL,
      name                  TEXT,
      description           TEXT,
      duration_minutes      INTEGER NOT NULL,
      discovery_rate        REAL NOT NULL DEFAULT 0.3,
      energy_arc            TEXT NOT NULL DEFAULT 'steady',
      transition_smoothness REAL NOT NULL DEFAULT 0.5,
      max_per_artist        INTEGER NOT NULL DEFAULT 3,
      seed_track_id         INTEGER REFERENCES tracks(id),
      source_preference     TEXT NOT NULL DEFAULT 'library',
      spotify_playlist_id   TEXT,
      spotify_playlist_url  TEXT,
      track_count           INTEGER DEFAULT 0,
      total_duration_ms     INTEGER DEFAULT 0,
      generation_time_ms    INTEGER,
      ai_enhanced           INTEGER DEFAULT 0,
      created_at            TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_playlists_created ON playlists(created_at);

    -- Tracks belonging to generated playlists
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id    INTEGER NOT NULL REFERENCES tracks(id),
      position    INTEGER NOT NULL,
      score       REAL,
      segment     INTEGER,
      UNIQUE(playlist_id, position)
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
  `);

  setSchemaVersion(db, 5);
  logger.info('Migration v5 complete');
}

function migrateV6(db: DatabaseSync): void {
  logger.info('Running migration v6: AI genre inference tracking');

  const columns = db.prepare('PRAGMA table_info(tracks)').all() as { name: string }[];
  const hasGenreSource = columns.some((c) => c.name === 'genre_source');
  if (!hasGenreSource) {
    db.prepare('ALTER TABLE tracks ADD COLUMN genre_source TEXT').run();
  }

  // Backfill: existing genre_cluster values came from Spotify artist sync
  db.prepare("UPDATE tracks SET genre_source = 'spotify' WHERE genre_cluster IS NOT NULL AND genre_source IS NULL").run();

  setSchemaVersion(db, 6);
  logger.info('Migration v6 complete');
}

function migrateV7(db: DatabaseSync): void {
  logger.info('Running migration v7: DJ preferences');

  db.prepare(`
    CREATE TABLE IF NOT EXISTS dj_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1) DEFAULT 1,
      persona TEXT NOT NULL DEFAULT 'curator',
      custom_persona TEXT,
      chattiness TEXT NOT NULL DEFAULT 'balanced',
      discovery_appetite TEXT NOT NULL DEFAULT 'comfort',
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  db.prepare(`INSERT OR IGNORE INTO dj_preferences (id) VALUES (1)`).run();

  setSchemaVersion(db, 7);
  logger.info('Migration v7 complete');
}

function migrateV8(db: DatabaseSync): void {
  logger.info('Running migration v8: TTS settings');

  const columns = db.prepare('PRAGMA table_info(dj_preferences)').all() as { name: string }[];

  if (!columns.some((c) => c.name === 'tts_enabled')) {
    db.prepare(`ALTER TABLE dj_preferences ADD COLUMN tts_enabled INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!columns.some((c) => c.name === 'tts_voice')) {
    db.prepare(`ALTER TABLE dj_preferences ADD COLUMN tts_voice TEXT`).run();
  }
  if (!columns.some((c) => c.name === 'tts_duck_volume')) {
    db.prepare(`ALTER TABLE dj_preferences ADD COLUMN tts_duck_volume REAL NOT NULL DEFAULT 0.3`).run();
  }

  setSchemaVersion(db, 8);
  logger.info('Migration v8 complete');
}
