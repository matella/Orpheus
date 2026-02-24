import { getDb } from '../connection.js';
import type { PreferenceRow } from '../types.js';

/**
 * Get the preference score for a track. Returns 0.5 (neutral) if no record.
 */
export function getPreferenceScore(trackId: number): number {
  const db = getDb();
  const row = db.prepare('SELECT score FROM preferences WHERE track_id = ?').get(trackId) as
    | { score: number }
    | undefined;
  return row?.score ?? 0.5;
}

/**
 * Get full preference record for a track.
 */
export function getPreference(trackId: number): PreferenceRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM preferences WHERE track_id = ?').get(trackId) as
    | PreferenceRow
    | undefined;
  return row ?? null;
}

/**
 * Update preference score by a delta, clamped to [0, 1].
 * Creates the record if it doesn't exist.
 */
export function updatePreference(trackId: number, delta: number): void {
  const db = getDb();
  const existing = getPreference(trackId);

  if (existing) {
    const newScore = Math.max(0, Math.min(1, existing.score + delta));
    db.prepare(`
      UPDATE preferences SET score = ?, updated_at = datetime('now') WHERE track_id = ?
    `).run(newScore, trackId);
  } else {
    const score = Math.max(0, Math.min(1, 0.5 + delta));
    db.prepare(`
      INSERT INTO preferences (track_id, score, updated_at) VALUES (?, ?, datetime('now'))
    `).run(trackId, score);
  }
}

/**
 * Record a play event (increment play count, update last_played_at).
 */
export function recordPlay(trackId: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO preferences (track_id, play_count, last_played_at, updated_at)
    VALUES (?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(track_id) DO UPDATE SET
      play_count = play_count + 1,
      last_played_at = datetime('now'),
      updated_at = datetime('now')
  `).run(trackId);
}

/**
 * Record a skip event.
 */
export function recordSkip(trackId: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO preferences (track_id, skip_count, updated_at)
    VALUES (?, 1, datetime('now'))
    ON CONFLICT(track_id) DO UPDATE SET
      skip_count = skip_count + 1,
      updated_at = datetime('now')
  `).run(trackId);
}

/**
 * Record a like.
 */
export function recordLike(trackId: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO preferences (track_id, like_count, updated_at)
    VALUES (?, 1, datetime('now'))
    ON CONFLICT(track_id) DO UPDATE SET
      like_count = like_count + 1,
      updated_at = datetime('now')
  `).run(trackId);
}

/**
 * Record a dislike.
 */
export function recordDislike(trackId: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO preferences (track_id, dislike_count, updated_at)
    VALUES (?, 1, datetime('now'))
    ON CONFLICT(track_id) DO UPDATE SET
      dislike_count = dislike_count + 1,
      updated_at = datetime('now')
  `).run(trackId);
}

/**
 * Get top preferred tracks.
 */
export function getTopPreferences(limit: number = 50): PreferenceRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM preferences ORDER BY score DESC LIMIT ?',
  ).all(limit) as PreferenceRow[];
}
