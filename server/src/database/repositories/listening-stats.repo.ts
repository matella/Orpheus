import { getDb } from '../connection.js';

export interface ListeningStatsData {
  genreDistribution: { genre: string; count: number; percentage: number }[];
  topArtists: { artist: string; playCount: number }[];
  playsPerTimeBracket: { bracket: string; count: number }[];
  discoveryRate: number;
  externalPlayCount: number;
  internalPlayCount: number;
  totalUniqueTracksPlayed: number;
  avgPreferenceScore: number;
  preferenceDistribution: { bucket: string; count: number }[];
}

/**
 * Compute comprehensive listening stats combining Orpheus + Spotify data.
 */
export function computeListeningStats(daysBack: number = 30): ListeningStatsData {
  const db = getDb();
  const daysParam = `-${daysBack} days`;

  // Genre distribution from actual plays
  const genres = db.prepare(`
    SELECT t.genre_cluster as genre, COUNT(*) as count
    FROM interactions i
    JOIN tracks t ON i.track_id = t.id
    WHERE i.interaction_type = 'play'
      AND t.genre_cluster IS NOT NULL
      AND i.created_at >= datetime('now', ?)
    GROUP BY t.genre_cluster
    ORDER BY count DESC
  `).all(daysParam) as { genre: string; count: number }[];

  const genreTotal = genres.reduce((s, g) => s + g.count, 0);
  const genreDistribution = genres.map((g) => ({
    ...g,
    percentage: genreTotal > 0 ? Math.round((g.count / genreTotal) * 1000) / 10 : 0,
  }));

  // Top artists from plays
  const topArtists = db.prepare(`
    SELECT t.artist, COUNT(*) as playCount
    FROM interactions i
    JOIN tracks t ON i.track_id = t.id
    WHERE i.interaction_type = 'play'
      AND i.created_at >= datetime('now', ?)
    GROUP BY t.artist
    ORDER BY playCount DESC
    LIMIT 20
  `).all(daysParam) as { artist: string; playCount: number }[];

  // Plays per time bracket
  const playsPerTimeBracket = db.prepare(`
    SELECT
      CASE
        WHEN CAST(strftime('%H', created_at) AS INTEGER) >= 6
          AND CAST(strftime('%H', created_at) AS INTEGER) < 12 THEN 'morning'
        WHEN CAST(strftime('%H', created_at) AS INTEGER) >= 12
          AND CAST(strftime('%H', created_at) AS INTEGER) < 17 THEN 'afternoon'
        WHEN CAST(strftime('%H', created_at) AS INTEGER) >= 17
          AND CAST(strftime('%H', created_at) AS INTEGER) < 22 THEN 'evening'
        ELSE 'night'
      END as bracket,
      COUNT(*) as count
    FROM interactions
    WHERE interaction_type = 'play'
      AND created_at >= datetime('now', ?)
    GROUP BY bracket
    ORDER BY count DESC
  `).all(daysParam) as { bracket: string; count: number }[];

  // External vs internal play counts
  // External plays have session_id IS NULL (from syncRecentlyPlayed)
  const playCounts = db.prepare(`
    SELECT
      COUNT(CASE WHEN session_id IS NULL THEN 1 END) as external_count,
      COUNT(CASE WHEN session_id IS NOT NULL THEN 1 END) as internal_count,
      COUNT(DISTINCT track_id) as unique_tracks
    FROM interactions
    WHERE interaction_type = 'play'
      AND created_at >= datetime('now', ?)
  `).get(daysParam) as { external_count: number; internal_count: number; unique_tracks: number };

  // Discovery rate: tracks played for the first time in the period
  const totalPlayed = playCounts.unique_tracks;
  const firstTimePlays = db.prepare(`
    SELECT COUNT(*) as count
    FROM (
      SELECT track_id, MIN(created_at) as first_play
      FROM interactions
      WHERE interaction_type = 'play'
      GROUP BY track_id
      HAVING first_play >= datetime('now', ?)
    )
  `).get(daysParam) as { count: number };

  const discoveryRate = totalPlayed > 0 ? firstTimePlays.count / totalPlayed : 0;

  // Average preference score and distribution
  const avgPref = db.prepare(
    'SELECT AVG(score) as avg_score FROM preferences WHERE play_count > 0',
  ).get() as { avg_score: number | null };

  const prefBuckets = db.prepare(`
    SELECT
      CASE
        WHEN score < 0.2 THEN '0.0-0.2'
        WHEN score < 0.4 THEN '0.2-0.4'
        WHEN score < 0.6 THEN '0.4-0.6'
        WHEN score < 0.8 THEN '0.6-0.8'
        ELSE '0.8-1.0'
      END as bucket,
      COUNT(*) as count
    FROM preferences
    WHERE play_count > 0
    GROUP BY bucket
    ORDER BY bucket
  `).all() as { bucket: string; count: number }[];

  return {
    genreDistribution,
    topArtists,
    playsPerTimeBracket,
    discoveryRate,
    externalPlayCount: playCounts.external_count,
    internalPlayCount: playCounts.internal_count,
    totalUniqueTracksPlayed: playCounts.unique_tracks,
    avgPreferenceScore: avgPref.avg_score ?? 0.5,
    preferenceDistribution: prefBuckets,
  };
}

/**
 * Store computed stats in the spotify_listening_stats table.
 */
export function setListeningStat(key: string, value: object): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO spotify_listening_stats (key, value, computed_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      computed_at = datetime('now')
  `).run(key, JSON.stringify(value));
}

/**
 * Get a stored listening stat.
 */
export function getListeningStat<T>(key: string): T | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT value FROM spotify_listening_stats WHERE key = ?',
  ).get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) as T : null;
}
