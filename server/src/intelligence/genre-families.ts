import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../shared/logger.js';

export interface GenreFamily {
  id: string;
  label: string;
  patterns: string[];
}

export const OTHER_FAMILY_ID = 'other';

let families: GenreFamily[] = [];
const cache = new Map<string, string>();

function getDataDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, '..', '..', 'data');
}

/**
 * Load genre families from data/genre_families.json. On failure every genre
 * classifies as "other" — the feature still works, just without grouping.
 */
export function loadGenreFamilies(): void {
  const path = resolve(getDataDir(), 'genre_families.json');
  cache.clear();
  if (!existsSync(path)) {
    logger.warn({ path }, 'Genre families file not found — all genres grouped as "other"');
    families = [];
    return;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { families: GenreFamily[] };
    families = parsed.families.map((f) => ({ ...f, patterns: f.patterns.map((p) => p.toLowerCase()) }));
    logger.info({ families: families.length }, 'Loaded genre families');
  } catch (err) {
    logger.warn({ err, path }, 'Failed to load genre families');
    families = [];
  }
}

export function getGenreFamilies(): GenreFamily[] {
  return families;
}

/**
 * Family id of a Spotify genre: the first family (file order) with a pattern
 * contained in the lower-cased genre, else "other".
 */
export function classifyGenre(genre: string): string {
  const key = genre.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const match = families.find((f) => f.patterns.some((p) => key.includes(p)));
  const id = match?.id ?? OTHER_FAMILY_ID;
  cache.set(key, id);
  return id;
}

export function familyLabel(id: string): string {
  if (id === OTHER_FAMILY_ID) return 'Other';
  return families.find((f) => f.id === id)?.label ?? id;
}
