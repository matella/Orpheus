import { getDb } from '../database/connection.js';
import { logger } from '../shared/logger.js';
import type { SteeringControls } from './types.js';
import { DEFAULT_STEERING, STEERING_KEYS } from './types.js';

/** Map from SteeringControls key to settings table key. */
const SETTINGS_KEY_MAP: Record<keyof SteeringControls, string> = {
  energy: 'steering:energy',
  mood: 'steering:mood',
  familiarity: 'steering:familiarity',
  vocalVsInstrumental: 'steering:vocalVsInstrumental',
  aggressiveness: 'steering:aggressiveness',
  genreOpenness: 'steering:genreOpenness',
  focusVsParty: 'steering:focusVsParty',
};

/**
 * Load steering controls from the settings table.
 * Returns defaults for any missing keys.
 */
export function loadSteeringControls(): SteeringControls {
  const db = getDb();
  const controls: SteeringControls = { ...DEFAULT_STEERING };

  for (const key of STEERING_KEYS) {
    const settingsKey = SETTINGS_KEY_MAP[key];
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingsKey) as
      | { value: string }
      | undefined;

    if (row) {
      const parsed = parseFloat(row.value);
      if (!isNaN(parsed)) {
        controls[key] = parsed;
      }
    }
  }

  return controls;
}

/**
 * Save all 7 steering control values to the settings table.
 */
export function saveSteeringControls(controls: SteeringControls): void {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
  );

  for (const key of STEERING_KEYS) {
    const settingsKey = SETTINGS_KEY_MAP[key];
    stmt.run(settingsKey, String(controls[key]));
  }

  logger.debug({ controls }, 'Steering controls saved');
}

/**
 * Record a steering snapshot to the steering_history table.
 */
export function recordSteeringSnapshot(
  sessionId: number | null,
  controls: SteeringControls,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO steering_history
      (session_id, energy, mood, familiarity, vocal_vs_instrumental, aggressiveness, genre_openness, focus_vs_party)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    controls.energy,
    controls.mood,
    controls.familiarity,
    controls.vocalVsInstrumental,
    controls.aggressiveness,
    controls.genreOpenness,
    controls.focusVsParty,
  );
}
