import { getDb } from '../connection.js';
import type { MonthlyRecapRow } from '../types.js';

/**
 * Get a monthly recap for a specific year/month.
 */
export function getMonthlyRecap(year: number, month: number): MonthlyRecapRow | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM monthly_recaps WHERE year = ? AND month = ?',
  ).get(year, month) as MonthlyRecapRow | undefined;
  return row ?? null;
}

/**
 * Get all monthly recaps (most recent first).
 */
export function getAllMonthlyRecaps(limit: number = 12): MonthlyRecapRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM monthly_recaps ORDER BY year DESC, month DESC LIMIT ?',
  ).all(limit) as MonthlyRecapRow[];
}

/**
 * Insert or replace a monthly recap.
 */
export function upsertMonthlyRecap(
  year: number,
  month: number,
  recap: string,
  stats: object,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO monthly_recaps (year, month, recap, stats)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(year, month) DO UPDATE SET
      recap = excluded.recap,
      stats = excluded.stats,
      created_at = datetime('now')
  `).run(year, month, recap, JSON.stringify(stats));
}
