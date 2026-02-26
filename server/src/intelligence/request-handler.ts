import { logger } from '../shared/logger.js';
import { parseUserMusicRequest } from '../ai/service.js';
import { searchLibraryTracks } from '../database/repositories/track.repo.js';
import { searchSpotifyAndUpsert } from '../spotify/search.js';
import type { TrackRow } from '../database/types.js';
import type { ParsedMusicRequest } from '../ai/prompts.js';

const MAX_REQUEST_TRACKS = 10;
const DEFAULT_TRACK_COUNT = 5;

export interface RequestResult {
  tracks: TrackRow[];
  parsed: ParsedMusicRequest;
  source: 'ai' | 'keyword';
}

/**
 * Process a natural language music request.
 * Parses intent (via AI or keyword fallback), searches library then Spotify,
 * and returns matching tracks ready for queue injection.
 */
export async function handleMusicRequest(prompt: string): Promise<RequestResult> {
  // 1. Parse intent — try AI first, fall back to keywords
  let parsed: ParsedMusicRequest;
  let source: 'ai' | 'keyword';

  const aiParsed = await parseUserMusicRequest(prompt);
  if (aiParsed) {
    parsed = aiParsed;
    source = 'ai';
  } else {
    parsed = parseWithKeywords(prompt);
    source = 'keyword';
  }

  // Clamp track count
  parsed.trackCount = Math.max(1, Math.min(MAX_REQUEST_TRACKS, parsed.trackCount));

  logger.info({ parsed, source }, 'Music request parsed');

  // 2. Search library first
  let tracks = searchLibraryTracks({
    artists: parsed.artists,
    genres: parsed.genres,
    moods: parsed.moods,
    limit: parsed.trackCount * 3,
  });

  // 3. If library results are thin, search Spotify
  if (tracks.length < parsed.trackCount && parsed.searchSpotify) {
    const spotifyQuery = buildSpotifyQuery(parsed, prompt);
    if (spotifyQuery) {
      const spotifyTracks = await searchSpotifyAndUpsert(
        spotifyQuery,
        parsed.trackCount - tracks.length,
      );
      tracks = [...tracks, ...spotifyTracks];
    }
  }

  // 4. Deduplicate by track ID
  const seen = new Set<number>();
  tracks = tracks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  // 5. Shuffle and trim to requested count
  shuffleArray(tracks);
  tracks = tracks.slice(0, parsed.trackCount);

  logger.info(
    { trackCount: tracks.length, requested: parsed.trackCount },
    'Music request fulfilled',
  );

  return { tracks, parsed, source };
}

// ── Keyword Fallback Parser ──────────────────────────────────────

const GENRE_KEYWORDS: Record<string, string[]> = {
  'kpop': ['kpop', 'k-pop', 'korean pop'],
  'rock': ['rock'],
  'metal': ['metal', 'heavy metal'],
  'pop': ['pop'],
  'hip-hop': ['hip hop', 'hip-hop', 'rap'],
  'electronic': ['electronic', 'edm', 'techno', 'house'],
  'jazz': ['jazz'],
  'classical': ['classical', 'orchestra'],
  'r&b': ['r&b', 'rnb', 'r and b'],
  'indie': ['indie'],
  'country': ['country'],
  'latin': ['latin', 'reggaeton'],
  'folk': ['folk', 'acoustic'],
  'punk': ['punk'],
  'blues': ['blues'],
  'soul': ['soul'],
};

const MOOD_KEYWORDS: Record<string, string[]> = {
  'chill': ['chill', 'relaxed', 'calm', 'mellow', 'peaceful'],
  'energetic': ['energetic', 'pump', 'hype', 'intense', 'upbeat'],
  'happy': ['happy', 'bright', 'cheerful', 'feel good', 'feel-good'],
  'sad': ['sad', 'melancholy', 'somber', 'down'],
  'aggressive': ['aggressive', 'angry', 'hard', 'heavy'],
  'focus': ['focus', 'study', 'concentrate', 'work'],
  'party': ['party', 'dance', 'club'],
};

function parseWithKeywords(prompt: string): ParsedMusicRequest {
  const lower = prompt.toLowerCase();
  const artists: string[] = [];
  const genres: string[] = [];
  const moods: string[] = [];
  const descriptors: string[] = [];

  // Genre detection
  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      genres.push(genre);
    }
  }

  // Mood detection
  for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      moods.push(mood);
    }
  }

  // Discovery descriptors
  if (/surprise|new|discover|something different|explore|random/.test(lower)) {
    descriptors.push('discovery');
  }

  // Artist extraction — only when no genre/mood matched
  if (genres.length === 0 && moods.length === 0 && descriptors.length === 0) {
    const artistPatterns = [
      /(?:play|add|queue|put on)\s+(?:some\s+|a few\s+|more\s+)?(.+?)(?:\s+songs?|\s+tracks?|\s+music|\s+in the queue)?$/i,
      /(?:by|from)\s+(.+)/i,
    ];

    for (const pattern of artistPatterns) {
      const match = lower.match(pattern);
      if (match?.[1]) {
        const candidate = match[1].trim();
        if (candidate.length > 1 && candidate.length < 60) {
          artists.push(candidate);
          break;
        }
      }
    }
  }

  // Track count detection
  let trackCount = DEFAULT_TRACK_COUNT;
  const countMatch = lower.match(/(\d+)\s+(?:songs?|tracks?)/);
  if (countMatch) {
    trackCount = parseInt(countMatch[1], 10);
  } else if (/a few|couple/.test(lower)) {
    trackCount = 3;
  } else if (/many|lots|bunch/.test(lower)) {
    trackCount = 8;
  }

  return {
    artists,
    genres,
    moods,
    descriptors,
    trackCount,
    searchSpotify: artists.length > 0 || genres.length > 0,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function buildSpotifyQuery(parsed: ParsedMusicRequest, rawPrompt: string): string {
  const parts: string[] = [];
  if (parsed.artists.length > 0) parts.push(`artist:${parsed.artists[0]}`);
  if (parsed.genres.length > 0) parts.push(`genre:${parsed.genres[0]}`);
  // Fall back to raw prompt if nothing structured was extracted
  if (parts.length === 0) return rawPrompt.slice(0, 100);
  return parts.join(' ');
}

function shuffleArray<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
