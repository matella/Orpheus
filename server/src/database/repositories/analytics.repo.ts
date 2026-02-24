import { getDb } from '../connection.js';

/**
 * Get skip rate over a time window.
 */
export function getSkipRate(daysBack: number = 7): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(CASE WHEN interaction_type = 'skip' THEN 1 END) as skips,
      COUNT(*) as total
    FROM interactions
    WHERE interaction_type IN ('play', 'skip')
      AND created_at >= datetime('now', ?)
  `).get(`-${daysBack} days`) as { skips: number; total: number };

  return row.total === 0 ? 0 : row.skips / row.total;
}

/**
 * Get average completion rate over a time window.
 */
export function getCompletionRate(daysBack: number = 7): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT AVG(completion_ratio) as avg_completion
    FROM interactions
    WHERE completion_ratio IS NOT NULL
      AND created_at >= datetime('now', ?)
  `).get(`-${daysBack} days`) as { avg_completion: number | null };

  return row.avg_completion ?? 0;
}

/**
 * Get genre distribution over a time window.
 */
export function getGenreDistribution(daysBack: number = 30): { genre: string; count: number }[] {
  const db = getDb();
  return db.prepare(`
    SELECT t.genre_cluster as genre, COUNT(*) as count
    FROM interactions i
    JOIN tracks t ON i.track_id = t.id
    WHERE i.interaction_type = 'play'
      AND t.genre_cluster IS NOT NULL
      AND i.created_at >= datetime('now', ?)
    GROUP BY t.genre_cluster
    ORDER BY count DESC
  `).all(`-${daysBack} days`) as { genre: string; count: number }[];
}

/**
 * Get energy trend for a session.
 */
export function getEnergyTrend(sessionId: number): { timestamp: string; energy: number }[] {
  const db = getDb();
  return db.prepare(`
    SELECT recorded_at as timestamp, energy
    FROM state_history
    WHERE session_id = ? AND energy IS NOT NULL
    ORDER BY recorded_at ASC
  `).all(sessionId) as { timestamp: string; energy: number }[];
}

/**
 * Get listening hours distribution by hour of day.
 */
export function getListeningHourDistribution(daysBack: number = 30): { hour: number; minutes: number }[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      CAST(strftime('%H', created_at) AS INTEGER) as hour,
      ROUND(SUM(listen_duration_ms) / 60000.0, 1) as minutes
    FROM interactions
    WHERE listen_duration_ms IS NOT NULL
      AND created_at >= datetime('now', ?)
    GROUP BY hour
    ORDER BY hour
  `).all(`-${daysBack} days`) as { hour: number; minutes: number }[];
}

/**
 * Get top tracks by play count.
 */
export function getTopTracks(daysBack: number = 30, limit: number = 20): {
  trackId: number;
  name: string;
  artist: string;
  playCount: number;
}[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      t.id as trackId,
      t.name,
      t.artist,
      COUNT(*) as playCount
    FROM interactions i
    JOIN tracks t ON i.track_id = t.id
    WHERE i.interaction_type = 'play'
      AND i.created_at >= datetime('now', ?)
    GROUP BY t.id
    ORDER BY playCount DESC
    LIMIT ?
  `).all(`-${daysBack} days`, limit) as {
    trackId: number;
    name: string;
    artist: string;
    playCount: number;
  }[];
}

/**
 * Get total listening time in milliseconds.
 */
export function getTotalListeningTime(daysBack: number = 30): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COALESCE(SUM(listen_duration_ms), 0) as total
    FROM interactions
    WHERE listen_duration_ms IS NOT NULL
      AND created_at >= datetime('now', ?)
  `).get(`-${daysBack} days`) as { total: number };
  return row.total;
}

/**
 * Get discovery rate: ratio of first-time tracks vs repeated.
 */
export function getDiscoveryRate(daysBack: number = 30): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN play_rank = 1 THEN track_id END) as new_tracks,
      COUNT(DISTINCT track_id) as total_tracks
    FROM (
      SELECT track_id,
        ROW_NUMBER() OVER (PARTITION BY track_id ORDER BY created_at) as play_rank
      FROM interactions
      WHERE interaction_type = 'play'
        AND created_at >= datetime('now', ?)
    )
  `).get(`-${daysBack} days`) as { new_tracks: number; total_tracks: number };

  return row.total_tracks === 0 ? 0 : row.new_tracks / row.total_tracks;
}

/**
 * Store or update a cached analytics value.
 */
export function setCacheValue(key: string, value: object, ttlHours: number = 24): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO analytics_cache (key, value, computed_at, expires_at)
    VALUES (?, ?, datetime('now'), datetime('now', ?))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      computed_at = datetime('now'),
      expires_at = datetime('now', ?)
  `).run(key, JSON.stringify(value), `+${ttlHours} hours`, `+${ttlHours} hours`);
}

/**
 * Get a cached analytics value (returns null if expired or missing).
 */
export function getCacheValue<T>(key: string): T | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT value FROM analytics_cache
    WHERE key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).get(key) as { value: string } | undefined;

  if (!row) return null;
  return JSON.parse(row.value) as T;
}
