import type { TrackRow } from '../database/types.js';
import { getTracksWithFeatures, searchLibraryTracks } from '../database/repositories/track.repo.js';
import { getTrackById } from '../database/repositories/track.repo.js';
import { getPreferenceScore } from '../database/repositories/preference.repo.js';
import { getRecentlyPlayedTrackIds } from '../database/repositories/interaction.repo.js';
import {
  insertPlaylistWithTracks,
  type InsertPlaylistData,
  type InsertPlaylistTrackData,
} from '../database/repositories/playlist.repo.js';
import { scoreTrack } from './scorer.js';
import { greedyNearestNeighbor } from './track-ordering.js';
import type { ScoringContext, StateVector, SteeringControls } from './types.js';
import { DEFAULT_STEERING } from './types.js';
import { parsePlaylistPrompt, generatePlaylistName, suggestArtistsForRequest } from '../ai/service.js';
import { createSpotifyPlaylist, addTracksToPlaylist } from '../spotify/player.js';
import { getGenreAliases } from '../ai/knowledge.js';
import { getSpotifyRecommendations } from '../spotify/library.js';
import { searchSpotifyAndUpsert } from '../spotify/search.js';
import { broadcast } from '../api/websocket.js';
import { logger } from '../shared/logger.js';
import {
  PLAYLIST_MAX_TRACKS,
  PLAYLIST_ENERGY_ARC_SEGMENTS,
  PLAYLIST_SPOTIFY_DISCOVERY_LIMIT,
} from '../shared/constants.js';

// ── Types ────────────────────────────────────────────────────────

export type EnergyArc = 'steady' | 'build_up' | 'wind_down' | 'peak_and_fade';

export interface PlaylistGenerationRequest {
  prompt: string;
  durationMinutes: number;
  discoveryRate: number;
  energyArc: EnergyArc;
  transitionSmoothness: number;
  maxPerArtist: number;
  seedTrackId?: number | null;
  sourcePreference: 'library' | 'library_and_spotify';
  createSpotifyPlaylist?: boolean;
}

export interface PlaylistGenerationResult {
  id: number;
  tracks: { track: TrackRow; score: number; segment: number; position: number }[];
  name: string;
  description: string;
  totalDurationMs: number;
  spotifyPlaylistId?: string;
  spotifyPlaylistUrl?: string;
  aiEnhanced: boolean;
  generationTimeMs: number;
}

export interface PlaylistProgressEvent {
  phase: 'parsing' | 'candidates' | 'scoring' | 'ordering' | 'spotify_discovery' | 'ai_refinement' | 'spotify_creation' | 'complete';
  progress: number;
  message: string;
  trackCount?: number;
  totalDurationMs?: number;
}

// ── Energy Arc Profiles ──────────────────────────────────────────

const ENERGY_ARC_PROFILES: Record<EnergyArc, number[]> = {
  steady:        [0.5, 0.5, 0.5, 0.5, 0.5],
  build_up:      [0.3, 0.4, 0.55, 0.7, 0.9],
  wind_down:     [0.8, 0.7, 0.5, 0.4, 0.3],
  peak_and_fade: [0.4, 0.65, 0.9, 0.6, 0.3],
};

// ── Main Generator ───────────────────────────────────────────────

export async function generatePlaylist(
  request: PlaylistGenerationRequest,
): Promise<PlaylistGenerationResult> {
  const startTime = Date.now();
  let aiEnhanced = false;

  // ── Step 1: Parse the prompt ──
  emitProgress({ phase: 'parsing', progress: 5, message: 'Analyzing your request...' });

  const parsed = await parsePlaylistPrompt(request.prompt);
  const artists = parsed?.artists ?? [];
  const genres = parsed?.genres ?? [];
  const moods = parsed?.moods ?? [];
  const descriptors = parsed?.descriptors ?? [];
  const searchSpotify = parsed?.searchSpotify ?? false;

  // Use AI-suggested energy arc if user didn't explicitly set one (i.e. left at default)
  let effectiveArc = request.energyArc;
  if (parsed?.suggestedEnergyArc && request.energyArc === 'steady') {
    const suggested = parsed.suggestedEnergyArc as EnergyArc;
    if (suggested in ENERGY_ARC_PROFILES) {
      effectiveArc = suggested;
    }
  }

  if (parsed) aiEnhanced = true;

  // If AI parsing failed or returned partial results, supplement with keyword extraction
  const keywords = extractKeywords(request.prompt);
  const effectiveArtists = artists.length > 0 ? artists : keywords.artists;
  const effectiveGenres = genres.length > 0 ? genres : keywords.genres;
  const effectiveMoods = moods.length > 0 ? moods : keywords.moods;

  // ── Step 2: Build candidate pool ──
  emitProgress({ phase: 'candidates', progress: 15, message: 'Building candidate pool...' });

  let candidates = buildCandidatePool(effectiveArtists, effectiveGenres, effectiveMoods);

  // If source includes Spotify discovery, fetch additional tracks
  if (request.sourcePreference === 'library_and_spotify') {
    emitProgress({ phase: 'spotify_discovery', progress: 25, message: 'Discovering tracks on Spotify...' });
    const spotifyTracks = await fetchSpotifyDiscovery(
      effectiveArtists,
      effectiveGenres,
      effectiveMoods,
      request.prompt,
      searchSpotify,
    );
    // Merge without duplicates
    const existingIds = new Set(candidates.map((t) => t.id));
    for (const t of spotifyTracks) {
      if (!existingIds.has(t.id)) {
        candidates.push(t);
        existingIds.add(t.id);
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error('No tracks found matching your criteria. Try broadening your request.');
  }

  logger.info({ candidates: candidates.length, artists: effectiveArtists, genres: effectiveGenres, moods: effectiveMoods }, 'Playlist candidate pool built');

  // ── Step 3: Score and select tracks per energy arc segment ──
  const targetDurationMs = request.durationMinutes * 60 * 1000;
  const arcProfile = ENERGY_ARC_PROFILES[effectiveArc];
  const segmentCount = PLAYLIST_ENERGY_ARC_SEGMENTS;
  const segmentDurationMs = targetDurationMs / segmentCount;

  // If seed track provided, it's always first
  const seedTrack = request.seedTrackId ? getTrackById(request.seedTrackId) : null;

  const selectedTracks: { track: TrackRow; score: number; segment: number }[] = [];
  const artistCounts = new Map<string, number>();
  const usedTrackIds = new Set<number>();
  let totalDurationMs = 0;

  // Add seed track first
  if (seedTrack) {
    selectedTracks.push({ track: seedTrack, score: 1.0, segment: 0 });
    usedTrackIds.add(seedTrack.id);
    totalDurationMs += seedTrack.duration_ms;
    artistCounts.set(seedTrack.artist, 1);
  }

  for (let seg = 0; seg < segmentCount; seg++) {
    const segTargetEnergy = arcProfile[seg];
    const segRemainingMs = Math.max(0, segmentDurationMs - (seg === 0 && seedTrack ? seedTrack.duration_ms : 0));

    if (segRemainingMs <= 0) continue;
    if (totalDurationMs >= targetDurationMs) break;

    emitProgress({
      phase: 'scoring',
      progress: 35 + (seg / segmentCount) * 30,
      message: `Selecting tracks for segment ${seg + 1} of ${segmentCount}...`,
      trackCount: selectedTracks.length,
      totalDurationMs,
    });

    const context = buildScoringContext(
      segTargetEnergy,
      request.discoveryRate,
      effectiveGenres[0] ?? null,
      selectedTracks.map((t) => t.track),
    );

    // Score all remaining candidates
    const scoredCandidates = candidates
      .filter((t) => !usedTrackIds.has(t.id))
      .map((track) => ({ track, score: scoreTrack(track, context) }))
      .sort((a, b) => b.score - a.score);

    // Fill segment duration
    let segDuration = 0;
    for (const { track, score } of scoredCandidates) {
      if (segDuration >= segRemainingMs) break;
      if (totalDurationMs >= targetDurationMs) break;
      if (selectedTracks.length >= PLAYLIST_MAX_TRACKS) break;

      // Artist cap check
      const currentCount = artistCounts.get(track.artist) ?? 0;
      if (currentCount >= request.maxPerArtist) continue;

      selectedTracks.push({ track, score, segment: seg });
      usedTrackIds.add(track.id);
      artistCounts.set(track.artist, currentCount + 1);
      segDuration += track.duration_ms;
      totalDurationMs += track.duration_ms;
    }
  }

  if (selectedTracks.length === 0) {
    throw new Error('Could not select any tracks for the playlist. Try different parameters.');
  }

  // ── Step 4: Order tracks for smooth transitions ──
  emitProgress({ phase: 'ordering', progress: 70, message: 'Optimizing track order...' });

  const orderedTracks = orderByTransitionSmoothness(selectedTracks, request.transitionSmoothness);

  // ── Step 5: AI naming ──
  emitProgress({ phase: 'ai_refinement', progress: 80, message: 'Generating playlist name...' });

  const dominantGenres = getDominantGenres(orderedTracks.map((t) => t.track));
  const avgEnergy = average(orderedTracks.map((t) => t.track.energy ?? 0.5));
  const avgValence = average(orderedTracks.map((t) => t.track.valence ?? 0.5));

  const aiName = await generatePlaylistName({
    prompt: request.prompt,
    trackCount: orderedTracks.length,
    durationMinutes: Math.round(totalDurationMs / 60000),
    dominantGenres,
    avgEnergy,
    avgValence,
    energyArc: effectiveArc,
    sampleTrackNames: orderedTracks.slice(0, 5).map((t) => `${t.track.name} by ${t.track.artist}`),
  });

  if (aiName) aiEnhanced = true;

  const playlistName = aiName?.name ?? generateFallbackName(request.prompt, effectiveGenres, effectiveMoods);
  const playlistDescription = aiName?.description ?? `${orderedTracks.length} tracks, ${Math.round(totalDurationMs / 60000)} minutes of curated music`;

  // ── Step 6: Create Spotify playlist ──
  let spotifyPlaylistId: string | undefined;
  let spotifyPlaylistUrl: string | undefined;

  if (request.createSpotifyPlaylist !== false) {
    emitProgress({ phase: 'spotify_creation', progress: 90, message: 'Creating Spotify playlist...' });

    try {
      const uris = orderedTracks.map((t) => `spotify:track:${t.track.spotify_id}`);
      const { id, url } = await createSpotifyPlaylist(playlistName, playlistDescription);
      await addTracksToPlaylist(id, uris);
      spotifyPlaylistId = id;
      spotifyPlaylistUrl = url;
      logger.info({ playlistId: id, tracks: uris.length }, 'Spotify playlist created');
    } catch (err) {
      logger.warn({ err }, 'Failed to create Spotify playlist — saving locally only');
    }
  }

  // ── Step 7: Persist to database ──
  const generationTimeMs = Date.now() - startTime;

  const trackData: InsertPlaylistTrackData[] = orderedTracks.map((t, i) => ({
    trackId: t.track.id,
    position: i + 1,
    score: t.score,
    segment: t.segment,
  }));

  const playlistId = insertPlaylistWithTracks(
    {
      prompt: request.prompt,
      name: playlistName,
      description: playlistDescription,
      durationMinutes: request.durationMinutes,
      discoveryRate: request.discoveryRate,
      energyArc: effectiveArc,
      transitionSmoothness: request.transitionSmoothness,
      maxPerArtist: request.maxPerArtist,
      seedTrackId: request.seedTrackId ?? null,
      sourcePreference: request.sourcePreference,
      spotifyPlaylistId: spotifyPlaylistId ?? null,
      spotifyPlaylistUrl: spotifyPlaylistUrl ?? null,
      trackCount: orderedTracks.length,
      totalDurationMs,
      generationTimeMs,
      aiEnhanced,
    },
    trackData,
  );

  const result: PlaylistGenerationResult = {
    id: playlistId,
    tracks: orderedTracks.map((t, i) => ({ ...t, position: i + 1 })),
    name: playlistName,
    description: playlistDescription,
    totalDurationMs,
    spotifyPlaylistId,
    spotifyPlaylistUrl,
    aiEnhanced,
    generationTimeMs,
  };

  emitProgress({
    phase: 'complete',
    progress: 100,
    message: 'Playlist ready!',
    trackCount: orderedTracks.length,
    totalDurationMs,
  });

  logger.info({
    playlistId,
    tracks: orderedTracks.length,
    durationMin: Math.round(totalDurationMs / 60000),
    generationMs: generationTimeMs,
    aiEnhanced,
    spotify: !!spotifyPlaylistUrl,
  }, 'Playlist generation complete');

  return result;
}

// ── Candidate Pool ───────────────────────────────────────────────

function buildCandidatePool(
  artists: string[],
  genres: string[],
  moods: string[],
): TrackRow[] {
  // If we have specific filters, use them
  if (artists.length > 0 || genres.length > 0 || moods.length > 0) {
    const filtered = searchLibraryTracks({
      artists,
      genres,
      moods,
      limit: 500,
    });

    // If filtered pool is too small, supplement with all tracks
    if (filtered.length >= 20) return filtered;

    const allTracks = getTracksWithFeatures();
    const filteredIds = new Set(filtered.map((t) => t.id));
    const supplement = allTracks.filter((t) => !filteredIds.has(t.id));

    return [...filtered, ...supplement.slice(0, 500 - filtered.length)];
  }

  // No filters — use entire library
  return getTracksWithFeatures();
}

async function fetchSpotifyDiscovery(
  artists: string[],
  genres: string[],
  moods: string[],
  prompt: string,
  searchSpotify: boolean,
): Promise<TrackRow[]> {
  const results: TrackRow[] = [];
  const seenIds = new Set<number>();

  const addUnique = (tracks: TrackRow[]) => {
    for (const t of tracks) {
      if (!seenIds.has(t.id)) {
        results.push(t);
        seenIds.add(t.id);
      }
    }
  };

  // Search by specific artists
  for (const artist of artists.slice(0, 3)) {
    const tracks = await searchSpotifyAndUpsert(artist, 10);
    addUnique(tracks);
  }

  // Search by genre + mood combos
  for (const genre of genres.slice(0, 2)) {
    const query = moods.length > 0 ? `${moods[0]} ${genre}` : genre;
    const tracks = await searchSpotifyAndUpsert(query, 10);
    addUnique(tracks);
  }

  // If still thin and we should search Spotify, try AI artist suggestions
  if (results.length < 10 && searchSpotify) {
    const suggestedArtists = await suggestArtistsForRequest(prompt);
    if (suggestedArtists) {
      for (const artist of suggestedArtists.slice(0, 3)) {
        const tracks = await searchSpotifyAndUpsert(artist, 5);
        addUnique(tracks);
      }
    }
  }

  // Use Spotify recommendations API with seeds
  try {
    const seedTracks = results.slice(0, 2).map((t) => t.spotify_id);
    const recs = await getSpotifyRecommendations({
      seedTracks: seedTracks.length > 0 ? seedTracks : undefined,
      seedGenres: genres.slice(0, 3),
      limit: PLAYLIST_SPOTIFY_DISCOVERY_LIMIT,
    });
    addUnique(recs);
  } catch {
    // Best-effort
  }

  return results;
}

// ── Scoring Context Builder ──────────────────────────────────────

function buildScoringContext(
  targetEnergy: number,
  discoveryRate: number,
  targetGenre: string | null,
  previousTracks: TrackRow[],
): ScoringContext {
  // Map discovery rate to steering.familiarity: 0% discovery = 1.0 familiarity, 100% = 0.0
  const familiarity = 1 - discoveryRate;

  const steering: SteeringControls = {
    ...DEFAULT_STEERING,
    energy: targetEnergy,
    familiarity,
    // High discovery → more genre openness
    genreOpenness: discoveryRate > 0.5 ? 0.7 : targetGenre ? 0.3 : 0.5,
  };

  // Build synthetic state vector from target energy and recent tracks
  const recentEnergies = previousTracks.slice(-5).map((t) => t.energy ?? 0.5);
  const recentValences = previousTracks.slice(-5).map((t) => t.valence ?? 0.5);

  const stateVector: StateVector = {
    energy: recentEnergies.length > 0 ? average(recentEnergies) : targetEnergy,
    valence: recentValences.length > 0 ? average(recentValences) : 0.5,
    tempo: 120,
    genreCluster: targetGenre,
    genreCounts: new Map(),
    familiarity: familiarity,
    vocalness: 0.5,
    aggressiveness: 0.3,
    context: getTimeBracket(),
    fatigueLevel: 0,
  };

  return {
    stateVector,
    steering,
    recentTrackIds: previousTracks.slice(-10).map((t) => t.id),
    recentArtists: previousTracks.slice(-5).map((t) => t.artist),
    sessionSkipCount: 0,
    sessionTrackCount: previousTracks.length,
    targetGenre,
  };
}

// ── Track Ordering ───────────────────────────────────────────────

function orderByTransitionSmoothness(
  tracks: { track: TrackRow; score: number; segment: number }[],
  smoothness: number,
): { track: TrackRow; score: number; segment: number }[] {
  if (tracks.length <= 2 || smoothness < 0.1) return tracks;

  // Group tracks by segment to preserve energy arc shape
  const segments = new Map<number, { track: TrackRow; score: number; segment: number }[]>();
  for (const t of tracks) {
    const seg = segments.get(t.segment) ?? [];
    seg.push(t);
    segments.set(t.segment, seg);
  }

  const result: { track: TrackRow; score: number; segment: number }[] = [];

  for (const [, segTracks] of [...segments.entries()].sort((a, b) => a[0] - b[0])) {
    if (segTracks.length <= 1 || smoothness < 0.3) {
      result.push(...segTracks);
      continue;
    }

    // Greedy nearest-neighbor ordering within segment
    const ordered = greedyNearestNeighbor(segTracks);
    result.push(...ordered);
  }

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────

function emitProgress(event: PlaylistProgressEvent): void {
  broadcast({ type: 'playlist_generation_progress', data: event });
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function getTimeBracket(): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

function getDominantGenres(tracks: TrackRow[]): string[] {
  const genreCounts = new Map<string, number>();
  for (const track of tracks) {
    if (track.genre_cluster) {
      genreCounts.set(track.genre_cluster, (genreCounts.get(track.genre_cluster) ?? 0) + 1);
    }
  }
  return [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([genre]) => genre);
}

function generateFallbackName(prompt: string, genres: string[], moods: string[]): string {
  const parts: string[] = [];
  if (moods.length > 0) parts.push(capitalize(moods[0]));
  if (genres.length > 0) parts.push(capitalize(genres[0]));
  if (parts.length > 0) {
    parts.push('Mix');
    return parts.join(' ');
  }
  // Truncate prompt as a last resort
  return prompt.slice(0, 40).trim() || 'Orpheus Mix';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Keyword Fallback Parser ──────────────────────────────────────

const GENRE_KEYWORDS_MAP: Record<string, string[]> = {
  'k-pop': ['kpop', 'k-pop', 'korean pop'],
  'rock': ['rock'],
  'metal': ['metal', 'heavy metal'],
  'pop': ['pop'],
  'hip-hop': ['hip-hop', 'hip hop', 'rap'],
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
  'lo-fi': ['lofi', 'lo-fi', 'lo fi'],
  'funk': ['funk'],
  'reggae': ['reggae'],
};

const MOOD_KEYWORDS = [
  'chill', 'relaxed', 'calm', 'mellow', 'energetic', 'upbeat', 'hype',
  'happy', 'sad', 'aggressive', 'focus', 'party', 'workout', 'study',
  'sleep', 'morning', 'evening',
];

function extractKeywords(prompt: string): { artists: string[]; genres: string[]; moods: string[] } {
  const lower = prompt.toLowerCase();

  // Merge loaded genre aliases for broader canonical genre matching
  const aliasMap = getGenreAliases();
  const effectiveGenreKeywords: Record<string, string[]> = { ...GENRE_KEYWORDS_MAP };
  if (aliasMap) {
    for (const [canon, aliases] of Object.entries(aliasMap)) {
      if (effectiveGenreKeywords[canon]) {
        const existing = new Set(effectiveGenreKeywords[canon]);
        for (const a of aliases) existing.add(a);
        effectiveGenreKeywords[canon] = [...existing];
      } else {
        effectiveGenreKeywords[canon] = [canon, ...aliases];
      }
    }
  }

  const genres: string[] = [];
  for (const [canon, keywords] of Object.entries(effectiveGenreKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      genres.push(canon);
    }
  }

  const moods = MOOD_KEYWORDS.filter((m) => lower.includes(m));
  return { artists: [], genres, moods };
}
