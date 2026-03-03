import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../shared/logger.js';
import { getTrackStats, getTrackById } from '../database/repositories/track.repo.js';
import { getTopArtistNames, getTopArtistGenreDistribution } from '../database/repositories/top-artists.repo.js';
import { getTopPreferences } from '../database/repositories/preference.repo.js';
import { getTotalListeningTime, getDiscoveryRate, getGenreDistribution } from '../database/repositories/analytics.repo.js';
import { getAllTimePreferences } from '../database/repositories/time-preferences.repo.js';

// ── Types ────────────────────────────────────────────────────────

export type GenreAliasMap = Record<string, string[]>;

export interface MoodMapping {
  genres: string[];
  energy: [number, number];
  valence: [number, number];
}

export type MoodMappingMap = Record<string, MoodMapping>;

export type SystemPromptLevel = 'full' | 'light' | 'minimal';

// ── Module-level cache (loaded once at startup) ──────────────────

let genreAliases: GenreAliasMap | null = null;
let moodMappings: MoodMappingMap | null = null;

// ── RAG context cache (refreshed periodically) ──────────────────

const RAG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let ragCache: { value: RAGContext; expiresAt: number } | null = null;

// ── Data Loading ─────────────────────────────────────────────────

function getDataDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, '..', '..', 'data');
}

export function loadKnowledgeFiles(): void {
  const dataDir = getDataDir();

  const aliasPath = resolve(dataDir, 'genre_aliases.json');
  if (existsSync(aliasPath)) {
    try {
      genreAliases = JSON.parse(readFileSync(aliasPath, 'utf-8')) as GenreAliasMap;
      logger.info({ genres: Object.keys(genreAliases).length }, 'Loaded genre aliases');
    } catch (err) {
      logger.warn({ err, path: aliasPath }, 'Failed to load genre aliases');
      genreAliases = null;
    }
  } else {
    logger.warn({ path: aliasPath }, 'Genre aliases file not found — AI genre normalization disabled');
  }

  const moodPath = resolve(dataDir, 'mood_mappings.json');
  if (existsSync(moodPath)) {
    try {
      moodMappings = JSON.parse(readFileSync(moodPath, 'utf-8')) as MoodMappingMap;
      logger.info({ moods: Object.keys(moodMappings).length }, 'Loaded mood mappings');
    } catch (err) {
      logger.warn({ err, path: moodPath }, 'Failed to load mood mappings');
      moodMappings = null;
    }
  } else {
    logger.warn({ path: moodPath }, 'Mood mappings file not found — AI mood mapping disabled');
  }
}

// ── Accessors ────────────────────────────────────────────────────

export function getGenreAliases(): GenreAliasMap | null {
  return genreAliases;
}

export function getMoodMappings(): MoodMappingMap | null {
  return moodMappings;
}

// ── RAG Context Gathering ────────────────────────────────────────

interface RAGContext {
  librarySize: number;
  tracksWithFeatures: number;
  topGenres: { genre: string; count: number }[];
  topArtistsRecent: string[];
  topArtistsAllTime: string[];
  topPreferredTracks: { name: string; artist: string; score: number }[];
  totalListeningHours: number;
  discoveryRate: number;
  listeningPatterns: { bracket: string; genres: string | null; sampleCount: number }[];
}

function gatherRAGContext(): RAGContext | null {
  // Return cached context if still fresh
  const now = Date.now();
  if (ragCache && now < ragCache.expiresAt) {
    return ragCache.value;
  }

  try {
    const stats = getTrackStats();
    const genreDist = getGenreDistribution();
    const recentArtists = getTopArtistNames('short_term', 15);
    const allTimeArtists = getTopArtistNames('medium_term', 15);
    const artistGenres = getTopArtistGenreDistribution();

    const topPrefs = getTopPreferences(10);
    const topPreferredTracks = topPrefs.map((pref) => {
      const track = getTrackById(pref.track_id);
      return {
        name: track?.name ?? 'Unknown',
        artist: track?.artist ?? 'Unknown',
        score: pref.score,
      };
    });

    const totalMs = getTotalListeningTime(30);
    const totalListeningHours = Math.round((totalMs / 3600000) * 10) / 10;
    const discoveryRate = getDiscoveryRate(30);

    const timePrefs = getAllTimePreferences();
    const listeningPatterns = timePrefs.map((tp) => ({
      bracket: tp.hour_bracket,
      genres: tp.preferred_genres,
      sampleCount: tp.sample_count,
    }));

    // Merge listening-based genre distribution with artist genres
    const mergedGenres = new Map<string, number>();
    for (const g of genreDist) {
      mergedGenres.set(g.genre, (mergedGenres.get(g.genre) ?? 0) + g.count);
    }
    for (const g of artistGenres.slice(0, 20)) {
      mergedGenres.set(g.genre, (mergedGenres.get(g.genre) ?? 0) + g.count);
    }
    const topGenres = [...mergedGenres.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([genre, count]) => ({ genre, count }));

    const result: RAGContext = {
      librarySize: stats.total,
      tracksWithFeatures: stats.withFeatures,
      topGenres,
      topArtistsRecent: recentArtists,
      topArtistsAllTime: allTimeArtists,
      topPreferredTracks,
      totalListeningHours,
      discoveryRate,
      listeningPatterns,
    };

    ragCache = { value: result, expiresAt: now + RAG_CACHE_TTL_MS };
    return result;
  } catch (err) {
    logger.warn({ err }, 'Failed to gather RAG context');
    return null;
  }
}

// ── System Prompt Builder ────────────────────────────────────────

export function buildSystemPrompt(level: SystemPromptLevel): string {
  const sections: string[] = [];

  sections.push(BASE_PERSONA);

  if (level === 'full' || level === 'light') {
    if (genreAliases) sections.push(buildGenreAliasSection());
    if (moodMappings) sections.push(buildMoodMappingSection());
  }

  if (level === 'full') {
    const rag = gatherRAGContext();
    if (rag) {
      sections.push(buildRAGSection(rag));
    } else {
      logger.warn('RAG context unavailable — system prompt downgraded from full to light');
    }
  }

  sections.push(OUTPUT_FORMAT_INSTRUCTIONS);

  return sections.join('\n\n');
}

// ── Prompt Sections ──────────────────────────────────────────────

const BASE_PERSONA = `You are Orpheus, an expert music intelligence system with deep knowledge of music theory, genres, artists, mood-genre relationships, and listening psychology.

Your expertise includes:
- Genre taxonomy: parent genres, subgenres, fusion genres, and regional variations (e.g., K-pop is a subgenre of pop with Korean origins; shoegaze blends noise-pop with ethereal textures)
- Artist knowledge: you understand artist catalogues, sonic signatures, stylistic evolutions, and cross-genre collaborations
- Mood-audio mapping: you know how audio features (energy, valence, tempo, acousticness, instrumentalness, danceability) map to emotional states and listening contexts
- Music transitions: you understand what makes tracks flow well together — key compatibility (Camelot wheel), BPM proximity, energy continuity, genre adjacency
- Listening psychology: you understand how time of day, activity context, and listening history affect music preferences and fatigue
- Music eras and movements: you can identify stylistic periods (80s synthwave, 90s grunge, 2010s EDM boom) and their sonic characteristics

You serve an autonomous music playback system that selects tracks from a user's Spotify library. Your role is to provide grounded, specific recommendations based on the user's actual listening data. Never fabricate artists or tracks that aren't present in the provided context.`;

const OUTPUT_FORMAT_INSTRUCTIONS = `CRITICAL OUTPUT RULES:
- Always respond with valid JSON only. No markdown, no commentary, no explanation outside the JSON object.
- Follow the exact JSON schema specified in each request.
- Use lowercase for genre names and normalize to canonical forms when possible.
- Be specific and grounded in any data provided. Prefer genres and artists present in the user's library.
- If you cannot make a recommendation, return the expected JSON schema with empty arrays and a brief explanation in any "reasoning" field.`;

function buildGenreAliasSection(): string {
  if (!genreAliases) return '';
  const lines = Object.entries(genreAliases)
    .slice(0, 30)
    .map(([canon, aliases]) => `  ${canon}: ${aliases.slice(0, 3).join(', ')}`)
    .join('\n');
  return `GENRE NORMALIZATION:
When interpreting or outputting genre references, normalize to these canonical names. Treat aliases as identical to the canonical form:
${lines}
Always use the canonical form (left side) in your JSON responses.`;
}

function buildMoodMappingSection(): string {
  if (!moodMappings) return '';
  const lines = Object.entries(moodMappings)
    .map(([mood, m]) =>
      `  ${mood}: genres=[${m.genres.slice(0, 4).join(', ')}] energy=${m.energy[0]}-${m.energy[1]} valence=${m.valence[0]}-${m.valence[1]}`,
    )
    .join('\n');
  return `MOOD-TO-MUSIC MAPPINGS:
Use these associations when interpreting mood/atmosphere descriptions:
${lines}
These are guidelines — use your knowledge to extend beyond these mappings when appropriate.`;
}

function buildRAGSection(rag: RAGContext): string {
  const genreList = rag.topGenres
    .slice(0, 10)
    .map((g) => `${g.genre} (${g.count})`)
    .join(', ');

  const recentArtists = rag.topArtistsRecent.slice(0, 8).join(', ') || 'unknown';
  const allTimeArtists = rag.topArtistsAllTime.slice(0, 8).join(', ') || 'unknown';

  const topTracks = rag.topPreferredTracks
    .slice(0, 5)
    .map((t) => `${t.name} by ${t.artist} (${t.score.toFixed(2)})`)
    .join(', ');

  const patterns = rag.listeningPatterns
    .filter((p) => p.sampleCount >= 3)
    .map((p) => `${p.bracket}: ${p.genres ?? 'varied'}`)
    .join(', ');

  return `USER LIBRARY CONTEXT (from Spotify data):
- Library size: ${rag.librarySize} tracks (${rag.tracksWithFeatures} with audio features analyzed)
- Top genres by frequency: ${genreList || 'varied'}
- Recent favorite artists: ${recentArtists}
- All-time favorite artists: ${allTimeArtists}
- Most preferred tracks: ${topTracks || 'not enough data yet'}
- Last 30 days: ${rag.totalListeningHours}h listened, ${(rag.discoveryRate * 100).toFixed(0)}% discovery rate
${patterns ? `- Time-of-day patterns: ${patterns}` : ''}

Ground your recommendations in this listener's actual taste profile. When suggesting genres, prefer those already represented in their library. When suggesting artists, favor those similar to their favorites.`;
}
