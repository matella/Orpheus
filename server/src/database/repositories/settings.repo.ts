import { getDb } from '../connection.js';

export const SETTING_KEYS = {
  AUTO_START_ENABLED: 'auto_start_enabled',
  AUTO_START_DELAY: 'auto_start_delay',
  QUIET_HOURS_START: 'quiet_hours_start',
  QUIET_HOURS_END: 'quiet_hours_end',
} as const;

export interface AutomationSettings {
  autoStartEnabled: boolean;
  autoStartDelay: number;
  quietHoursStart: number;
  quietHoursEnd: number;
}

/**
 * Get a single setting by key.
 */
export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/**
 * Get all settings as key-value pairs.
 */
export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/**
 * Upsert a single setting.
 */
export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

/**
 * Upsert multiple settings at once.
 */
export function setSettings(settings: Record<string, string>): void {
  const db = getDb();
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(settings)) {
    stmt.run(key, value);
  }
}

/**
 * Get automation settings as a typed object with parsed values.
 */
export function getAutomationSettings(): AutomationSettings {
  const all = getAllSettings();
  return {
    autoStartEnabled: all[SETTING_KEYS.AUTO_START_ENABLED] !== 'false',
    autoStartDelay: parseInt(all[SETTING_KEYS.AUTO_START_DELAY] ?? '5', 10),
    quietHoursStart: parseInt(all[SETTING_KEYS.QUIET_HOURS_START] ?? '23', 10),
    quietHoursEnd: parseInt(all[SETTING_KEYS.QUIET_HOURS_END] ?? '7', 10),
  };
}

/**
 * Check if the current time falls within quiet hours.
 * Handles overnight ranges (e.g., 23:00 - 07:00).
 */
export function isQuietHoursNow(): boolean {
  const { quietHoursStart, quietHoursEnd } = getAutomationSettings();
  const currentHour = new Date().getHours();

  // Same start/end means quiet hours are disabled
  if (quietHoursStart === quietHoursEnd) return false;

  if (quietHoursStart < quietHoursEnd) {
    // Same-day range (e.g., 13:00 - 17:00)
    return currentHour >= quietHoursStart && currentHour < quietHoursEnd;
  } else {
    // Overnight range (e.g., 23:00 - 07:00)
    return currentHour >= quietHoursStart || currentHour < quietHoursEnd;
  }
}
