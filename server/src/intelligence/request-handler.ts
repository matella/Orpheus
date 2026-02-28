import { logger } from '../shared/logger.js';
import { parseUserMusicRequest, suggestArtistsForRequest } from '../ai/service.js';
import { searchLibraryTracks } from '../database/repositories/track.repo.js';
import { searchSpotifyAndUpsert } from '../spotify/search.js';
import { selector } from './selector.js';
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

  // 3b. AI artist suggestion fallback — if results are still thin and no
  //     specific artist was requested, ask the AI to suggest artists matching
  //     the vague description, then search Spotify for each individually.
  if (tracks.length < parsed.trackCount && parsed.artists.length === 0) {
    const suggestedArtists = await suggestArtistsForRequest(prompt);
    if (suggestedArtists && suggestedArtists.length > 0) {
      logger.info({ suggestedArtists }, 'AI suggested artists for vague request');
      const remaining = parsed.trackCount - tracks.length;
      const tracksPerArtist = Math.max(1, Math.ceil(remaining / suggestedArtists.length));

      for (const artist of suggestedArtists) {
        if (tracks.length >= parsed.trackCount) break;
        const artistTracks = await searchSpotifyAndUpsert(
          `artist:${artist}`,
          tracksPerArtist,
        );
        tracks = [...tracks, ...artistTracks];
      }
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

  // 6. Steer the session toward the requested genre
  //    - Explicit genre request → use it directly
  //    - Artist request → infer genre from returned tracks' genre_cluster
  let targetGenre: string | null = null;
  if (parsed.genres.length > 0) {
    targetGenre = parsed.genres[0];
  } else if (tracks.length > 0) {
    const genreCounts = new Map<string, number>();
    for (const t of tracks) {
      if (t.genre_cluster) {
        genreCounts.set(t.genre_cluster, (genreCounts.get(t.genre_cluster) ?? 0) + 1);
      }
    }
    if (genreCounts.size > 0) {
      targetGenre = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  if (targetGenre) {
    selector.setTargetGenre(targetGenre);
  }

  logger.info(
    { trackCount: tracks.length, requested: parsed.trackCount, targetGenre },
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
  'piano': ['piano'],
  'ambient': ['ambient', 'atmospheric'],
  'lofi': ['lofi', 'lo-fi', 'lo fi'],
  'funk': ['funk'],
  'reggae': ['reggae'],
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
    searchSpotify: artists.length > 0 || genres.length > 0 || moods.length > 0,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function buildSpotifyQuery(parsed: ParsedMusicRequest, rawPrompt: string): string {
  // Artist-specific search — use Spotify's artist: filter
  if (parsed.artists.length > 0) {
    return `artist:${parsed.artists[0]}`;
  }
  // Genre search — use as plain text, not Spotify's unreliable genre: filter
  if (parsed.genres.length > 0) {
    return `${parsed.genres[0]} music`;
  }
  // Fallback to raw prompt
  return rawPrompt.slice(0, 100);
}

function shuffleArray<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
