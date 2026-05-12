import { getDb } from '../database/connection.js';
import { getTopArtists } from '../database/repositories/top-artists.repo.js';
import { getDjPreferences } from '../database/repositories/dj-preferences.repo.js';
import { loadSteeringControls } from './steering.js';
import type { SteeringControls } from './types.js';
import type { Chattiness, DiscoveryAppetite, Persona } from '../database/repositories/dj-preferences.repo.js';

export interface ListenerContext {
  topArtists: string[];
  topGenres: string[];
  recentTracks: Array<{ name: string; artist: string }>;
  justPlayed: { name: string; artist: string } | null;
  mood: string | null;
  steering: SteeringControls;
  localTime: Date;
  timePhrase: string;
  persona: Persona;
  customPersona: string | null;
  chattiness: Chattiness;
  discoveryAppetite: DiscoveryAppetite;
}

function getTimePhrase(hour: number): string {
  if (hour < 5) return 'deep night';
  if (hour < 9) return 'morning';
  if (hour < 12) return 'late morning';
  if (hour < 14) return 'midday';
  if (hour < 18) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function getRecentlyPlayedWithNames(limit: number): Array<{ name: string; artist: string }> {
  const db = getDb();
  return db.prepare(`
    SELECT t.name, t.artist
    FROM interactions i
    JOIN tracks t ON t.id = i.track_id
    WHERE i.interaction_type IN ('play', 'skip')
    ORDER BY i.created_at DESC
    LIMIT ?
  `).all(limit) as Array<{ name: string; artist: string }>;
}

/**
 * Assemble the full ListenerContext for the LLM curator.
 * Pulls from top-artists, interactions, steering controls, DJ preferences,
 * and the system clock. Always synchronous — all sources are local DB or memory.
 */
export function assembleListenerContext(
  currentTrack?: { name: string; artist: string } | null,
): ListenerContext {
  const now = new Date();

  // Top artists (short-term Spotify data, most relevant)
  const topArtistRows = getTopArtists('short_term', 20);
  const topArtists = topArtistRows.map((r) => r.name);

  // Derive top genres from top artist genres
  const genreCounts = new Map<string, number>();
  for (const row of topArtistRows) {
    try {
      const genres: string[] = JSON.parse(row.genres ?? '[]');
      for (const g of genres) {
        genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
      }
    } catch {
      // ignore malformed JSON
    }
  }
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([g]) => g);

  // Recent session tracks (most recent first, skip the just-played one)
  const recentRaw = getRecentlyPlayedWithNames(10);
  const recentTracks = currentTrack
    ? recentRaw.filter(
        (t) => !(t.name === currentTrack.name && t.artist === currentTrack.artist),
      ).slice(0, 6)
    : recentRaw.slice(0, 6);

  const steering = loadSteeringControls();

  // Mood from steering: use the mood label if strongly set
  let mood: string | null = null;
  if (steering.mood >= 0.75) mood = 'bright/uplifting';
  else if (steering.mood <= 0.25) mood = 'dark/melancholic';

  const prefs = getDjPreferences();

  return {
    topArtists,
    topGenres,
    recentTracks,
    justPlayed: currentTrack ?? null,
    mood,
    steering,
    localTime: now,
    timePhrase: getTimePhrase(now.getHours()),
    persona: prefs.persona,
    customPersona: prefs.customPersona,
    chattiness: prefs.chattiness,
    discoveryAppetite: prefs.discoveryAppetite,
  };
}
