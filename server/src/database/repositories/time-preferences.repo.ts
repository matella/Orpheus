import { getDb } from '../connection.js';

export interface TimePreferencesRow {
  hour_bracket: string;
  avg_energy: number;
  avg_valence: number;
  avg_tempo: number;
  avg_familiarity: number;
  avg_vocalness: number;
  avg_aggressiveness: number;
  preferred_genres: string | null;
  sample_count: number;
  updated_at: string;
}

/**
 * Get learned preferences for a specific time bracket.
 */
export function getTimePreferences(hourBracket: string): TimePreferencesRow | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM time_preferences WHERE hour_bracket = ?',
  ).get(hourBracket) as TimePreferencesRow | undefined;
  return row ?? null;
}

/**
 * Get all time preferences (for API visibility).
 */
export function getAllTimePreferences(): TimePreferencesRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM time_preferences ORDER BY hour_bracket',
  ).all() as unknown as TimePreferencesRow[];
}

/**
 * Update learned time preferences using incremental averaging.
 * Blends the new observation into the existing running average.
 */
export function updateTimePreferences(
  hourBracket: string,
  observation: {
    energy: number;
    valence: number;
    tempo: number;
    familiarity: number;
    vocalness: number;
    aggressiveness: number;
    topGenre: string | null;
  },
): void {
  const db = getDb();
  const existing = getTimePreferences(hourBracket);

  if (!existing) {
    // First observation for this bracket — insert directly
    db.prepare(`
      INSERT INTO time_preferences
        (hour_bracket, avg_energy, avg_valence, avg_tempo, avg_familiarity,
         avg_vocalness, avg_aggressiveness, preferred_genres, sample_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
    `).run(
      hourBracket,
      observation.energy,
      observation.valence,
      observation.tempo,
      observation.familiarity,
      observation.vocalness,
      observation.aggressiveness,
      observation.topGenre,
    );
    return;
  }

  // Incremental average: new_avg = old_avg + (value - old_avg) / (n + 1)
  const n = existing.sample_count + 1;

  // Merge genre: keep the most recently observed top genre
  const genres = observation.topGenre ?? existing.preferred_genres;

  db.prepare(`
    UPDATE time_preferences SET
      avg_energy = avg_energy + (? - avg_energy) / ?,
      avg_valence = avg_valence + (? - avg_valence) / ?,
      avg_tempo = avg_tempo + (? - avg_tempo) / ?,
      avg_familiarity = avg_familiarity + (? - avg_familiarity) / ?,
      avg_vocalness = avg_vocalness + (? - avg_vocalness) / ?,
      avg_aggressiveness = avg_aggressiveness + (? - avg_aggressiveness) / ?,
      preferred_genres = ?,
      sample_count = ?,
      updated_at = datetime('now')
    WHERE hour_bracket = ?
  `).run(
    observation.energy, n,
    observation.valence, n,
    observation.tempo, n,
    observation.familiarity, n,
    observation.vocalness, n,
    observation.aggressiveness, n,
    genres,
    n,
    hourBracket,
  );
}

/**
 * Reset all time preferences (for user-initiated reset).
 */
export function resetTimePreferences(): void {
  const db = getDb();
  db.prepare('DELETE FROM time_preferences').run();
}
