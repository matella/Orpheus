import { getDb } from '../connection.js';
import type { StateHistoryRow } from '../types.js';

export interface RecordStateData {
  sessionId: number;
  trackId?: number;
  energy?: number;
  valence?: number;
  tempo?: number;
  genreCluster?: string;
  familiarity?: number;
  vocalness?: number;
  aggressiveness?: number;
  context?: string;
  fatigueLevel?: number;
}

/**
 * Record a state vector snapshot.
 */
export function recordState(data: RecordStateData): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO state_history
      (session_id, track_id, energy, valence, tempo, genre_cluster, familiarity, vocalness, aggressiveness, context, fatigue_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.sessionId,
    data.trackId ?? null,
    data.energy ?? null,
    data.valence ?? null,
    data.tempo ?? null,
    data.genreCluster ?? null,
    data.familiarity ?? null,
    data.vocalness ?? null,
    data.aggressiveness ?? null,
    data.context ?? null,
    data.fatigueLevel ?? null,
  );
}

/**
 * Get state history for a session.
 */
export function getStateHistory(sessionId: number): StateHistoryRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM state_history WHERE session_id = ? ORDER BY recorded_at ASC',
  ).all(sessionId) as StateHistoryRow[];
}

/**
 * Get the energy curve for a session (for visualization).
 */
export function getEnergyCurve(sessionId: number): number[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT energy FROM state_history WHERE session_id = ? AND energy IS NOT NULL ORDER BY recorded_at ASC',
  ).all(sessionId) as { energy: number }[];
  return rows.map((r) => r.energy);
}
