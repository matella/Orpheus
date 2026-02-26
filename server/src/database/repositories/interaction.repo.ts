import { getDb } from '../connection.js';
import type { InteractionRow } from '../types.js';

export interface RecordInteractionData {
  trackId: number;
  sessionId?: number;
  interactionType: 'play' | 'skip' | 'like' | 'dislike' | 'replay';
  listenDurationMs?: number;
  completionRatio?: number;
  skipPositionMs?: number;
  /** ISO timestamp override — used for historical imports (defaults to now). */
  createdAt?: string;
}

/**
 * Record a user interaction with a track.
 */
export function recordInteraction(data: RecordInteractionData): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO interactions (track_id, session_id, interaction_type, listen_duration_ms, completion_ratio, skip_position_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.trackId,
    data.sessionId ?? null,
    data.interactionType,
    data.listenDurationMs ?? null,
    data.completionRatio ?? null,
    data.skipPositionMs ?? null,
    data.createdAt ?? new Date().toISOString(),
  );

  return Number(result.lastInsertRowid);
}

/**
 * Get interactions for a specific track.
 */
export function getInteractionsForTrack(trackId: number, limit: number = 50): InteractionRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM interactions WHERE track_id = ? ORDER BY created_at DESC LIMIT ?',
  ).all(trackId, limit) as unknown as InteractionRow[];
}

/**
 * Get recent interactions across all tracks.
 */
export function getRecentInteractions(limit: number = 50): InteractionRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM interactions ORDER BY created_at DESC LIMIT ?',
  ).all(limit) as unknown as InteractionRow[];
}

/**
 * Get interactions for a session.
 */
export function getSessionInteractions(sessionId: number): InteractionRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM interactions WHERE session_id = ? ORDER BY created_at ASC',
  ).all(sessionId) as unknown as InteractionRow[];
}

/**
 * Get skip rate for recent tracks.
 */
export function getRecentSkipRate(lastN: number = 10): number {
  const db = getDb();
  const rows = db.prepare(`
    SELECT interaction_type FROM interactions
    WHERE interaction_type IN ('play', 'skip')
    ORDER BY created_at DESC LIMIT ?
  `).all(lastN) as { interaction_type: string }[];

  if (rows.length === 0) return 0;
  const skips = rows.filter((r) => r.interaction_type === 'skip').length;
  return skips / rows.length;
}

/**
 * Get recently played track IDs (to exclude from candidate pool).
 */
export function getRecentlyPlayedTrackIds(limit: number = 50): number[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT track_id FROM interactions
    WHERE interaction_type IN ('play', 'skip')
    ORDER BY created_at DESC LIMIT ?
  `).all(limit) as { track_id: number }[];
  return rows.map((r) => r.track_id);
}
