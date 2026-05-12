import { getDb } from '../connection.js';

export type Persona = 'curator' | 'late_night' | 'hype' | 'chill' | 'custom';
export type Chattiness = 'silent' | 'minimal' | 'balanced' | 'chatty';
export type DiscoveryAppetite = 'comfort' | 'balanced' | 'adventurous';

export interface DjPreferences {
  persona: Persona;
  customPersona: string | null;
  chattiness: Chattiness;
  discoveryAppetite: DiscoveryAppetite;
  onboardingCompleted: boolean;
  ttsEnabled: boolean;
  ttsVoice: string | null;
  ttsDuckVolume: number;
}

interface DjPreferencesRow {
  persona: string;
  custom_persona: string | null;
  chattiness: string;
  discovery_appetite: string;
  onboarding_completed: number;
  tts_enabled: number;
  tts_voice: string | null;
  tts_duck_volume: number;
}

export function getDjPreferences(): DjPreferences {
  const db = getDb();
  const row = db
    .prepare('SELECT persona, custom_persona, chattiness, discovery_appetite, onboarding_completed, tts_enabled, tts_voice, tts_duck_volume FROM dj_preferences WHERE id = 1')
    .get() as DjPreferencesRow | undefined;

  if (!row) {
    return {
      persona: 'curator',
      customPersona: null,
      chattiness: 'balanced',
      discoveryAppetite: 'comfort',
      onboardingCompleted: false,
      ttsEnabled: false,
      ttsVoice: null,
      ttsDuckVolume: 0.3,
    };
  }

  return {
    persona: row.persona as Persona,
    customPersona: row.custom_persona,
    chattiness: row.chattiness as Chattiness,
    discoveryAppetite: row.discovery_appetite as DiscoveryAppetite,
    onboardingCompleted: row.onboarding_completed === 1,
    ttsEnabled: row.tts_enabled === 1,
    ttsVoice: row.tts_voice,
    ttsDuckVolume: row.tts_duck_volume,
  };
}

export function updateDjPreferences(patch: Partial<Omit<DjPreferences, 'onboardingCompleted'>>): DjPreferences {
  const db = getDb();
  const current = getDjPreferences();
  const next: DjPreferences = { ...current, ...patch };

  db.prepare(`
    UPDATE dj_preferences SET
      persona = ?,
      custom_persona = ?,
      chattiness = ?,
      discovery_appetite = ?,
      tts_enabled = ?,
      tts_voice = ?,
      tts_duck_volume = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `).run(
    next.persona,
    next.customPersona,
    next.chattiness,
    next.discoveryAppetite,
    next.ttsEnabled ? 1 : 0,
    next.ttsVoice,
    next.ttsDuckVolume,
  );

  return next;
}

export function markOnboardingComplete(): void {
  const db = getDb();
  db.prepare(`UPDATE dj_preferences SET onboarding_completed = 1, updated_at = datetime('now') WHERE id = 1`).run();
}
