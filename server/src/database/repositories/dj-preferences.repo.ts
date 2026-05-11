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
}

interface DjPreferencesRow {
  persona: string;
  custom_persona: string | null;
  chattiness: string;
  discovery_appetite: string;
  onboarding_completed: number;
}

export function getDjPreferences(): DjPreferences {
  const db = getDb();
  const row = db
    .prepare('SELECT persona, custom_persona, chattiness, discovery_appetite, onboarding_completed FROM dj_preferences WHERE id = 1')
    .get() as DjPreferencesRow | undefined;

  if (!row) {
    return {
      persona: 'curator',
      customPersona: null,
      chattiness: 'balanced',
      discoveryAppetite: 'comfort',
      onboardingCompleted: false,
    };
  }

  return {
    persona: row.persona as Persona,
    customPersona: row.custom_persona,
    chattiness: row.chattiness as Chattiness,
    discoveryAppetite: row.discovery_appetite as DiscoveryAppetite,
    onboardingCompleted: row.onboarding_completed === 1,
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
      updated_at = datetime('now')
    WHERE id = 1
  `).run(
    next.persona,
    next.customPersona,
    next.chattiness,
    next.discoveryAppetite,
  );

  return next;
}

export function markOnboardingComplete(): void {
  const db = getDb();
  db.prepare(`UPDATE dj_preferences SET onboarding_completed = 1, updated_at = datetime('now') WHERE id = 1`).run();
}
