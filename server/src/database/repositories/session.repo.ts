import { getDb } from '../connection.js';
import type { SessionRow } from '../types.js';

/**
 * Create a new playback session.
 */
export function createSession(data: {
  deviceId?: string;
  deviceName?: string;
  initialContext?: string;
  autoStarted?: boolean;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO sessions (device_id, device_name, initial_context, auto_started)
    VALUES (?, ?, ?, ?)
  `).run(
    data.deviceId ?? null,
    data.deviceName ?? null,
    data.initialContext ?? null,
    data.autoStarted ? 1 : 0,
  );

  return Number(result.lastInsertRowid);
}

/**
 * End a session by setting ended_at timestamp.
 */
export function endSession(sessionId: number, stats?: {
  trackCount?: number;
  totalDurationMs?: number;
  avgEnergy?: number;
  avgValence?: number;
}): void {
  const db = getDb();
  db.prepare(`
    UPDATE sessions SET
      ended_at = datetime('now'),
      track_count = COALESCE(?, track_count),
      total_duration_ms = COALESCE(?, total_duration_ms),
      avg_energy = COALESCE(?, avg_energy),
      avg_valence = COALESCE(?, avg_valence)
    WHERE id = ?
  `).run(
    stats?.trackCount ?? null,
    stats?.totalDurationMs ?? null,
    stats?.avgEnergy ?? null,
    stats?.avgValence ?? null,
    sessionId,
  );
}

/**
 * Increment track count for a session.
 */
export function incrementTrackCount(sessionId: number, durationMs: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE sessions SET
      track_count = track_count + 1,
      total_duration_ms = total_duration_ms + ?
    WHERE id = ?
  `).run(durationMs, sessionId);
}

/**
 * Get the currently active session (no ended_at).
 */
export function getActiveSession(): SessionRow | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
  ).get() as SessionRow | undefined;
  return row ?? null;
}

/**
 * Get a session by ID.
 */
export function getSessionById(id: number): SessionRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | SessionRow
    | undefined;
  return row ?? null;
}

/**
 * Get recent sessions (paginated).
 * Excludes empty sessions (0 tracks) since they carry no useful data.
 */
export function getSessionHistory(limit: number = 20, offset: number = 0): {
  sessions: SessionRow[];
  total: number;
} {
  const db = getDb();
  const sessions = db.prepare(
    'SELECT * FROM sessions WHERE track_count > 0 ORDER BY started_at DESC LIMIT ? OFFSET ?',
  ).all(limit, offset) as unknown as SessionRow[];
  const total = (db.prepare('SELECT COUNT(*) as count FROM sessions WHERE track_count > 0').get() as { count: number }).count;
  return { sessions, total };
}

/**
 * Delete a session and all its related data (used for empty sessions with 0 tracks).
 * Removes child rows from referencing tables first to satisfy foreign key constraints.
 */
export function deleteSession(sessionId: number): void {
  const db = getDb();
  // Wrap in savepoint to prevent partial deletes on crash
  db.prepare('SAVEPOINT delete_session').run();
  try {
    db.prepare('DELETE FROM interactions WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM state_history WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM steering_history WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM ai_suggestions WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    db.prepare('RELEASE delete_session').run();
  } catch (err) {
    db.prepare('ROLLBACK TO delete_session').run();
    throw err;
  }
}

/**
 * Update session name (AI-generated).
 */
export function updateSessionName(sessionId: number, name: string): void {
  const db = getDb();
  db.prepare('UPDATE sessions SET session_name = ? WHERE id = ?').run(name, sessionId);
}
