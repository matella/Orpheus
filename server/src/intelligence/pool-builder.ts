import { getCandidates } from './candidate-pool.js';
import { selector } from './selector.js';
import { stateVectorManager } from './state-vector.js';
import { loadSteeringControls } from './steering.js';
import { getTracksWithFeatures } from '../database/repositories/track.repo.js';
import { getPreference } from '../database/repositories/preference.repo.js';
import type { TrackRow } from '../database/types.js';
import type { DiscoveryAppetite } from '../database/repositories/dj-preferences.repo.js';
import type { CandidateTrack } from '../ai/prompts.js';
import { logger } from '../shared/logger.js';

const POOL_TARGET_MIN = 40;
const POOL_TARGET_MAX = 60;

/** Ratios [library, similar, discovery] per discovery appetite setting. */
const APPETITE_RATIOS: Record<DiscoveryAppetite, [number, number, number]> = {
  comfort: [0.65, 0.25, 0.10],
  balanced: [0.50, 0.35, 0.15],
  adventurous: [0.40, 0.30, 0.30],
};

/**
 * Adjust ratios based on genreOpenness steering axis.
 * High openness nudges ratios toward adventurous; low nudges toward comfort.
 */
function adjustRatiosForSteering(
  base: [number, number, number],
  genreOpenness: number,
): [number, number, number] {
  const adventurous: [number, number, number] = [0.40, 0.30, 0.30];
  const comfort: [number, number, number] = [0.65, 0.25, 0.10];

  if (genreOpenness >= 0.7) {
    // Blend 50% toward adventurous
    const blend = (genreOpenness - 0.7) / 0.3;
    return [
      base[0] + (adventurous[0] - base[0]) * blend * 0.5,
      base[1] + (adventurous[1] - base[1]) * blend * 0.5,
      base[2] + (adventurous[2] - base[2]) * blend * 0.5,
    ];
  }
  if (genreOpenness <= 0.3) {
    const blend = (0.3 - genreOpenness) / 0.3;
    return [
      base[0] + (comfort[0] - base[0]) * blend * 0.5,
      base[1] + (comfort[1] - base[1]) * blend * 0.5,
      base[2] + (comfort[2] - base[2]) * blend * 0.5,
    ];
  }
  return base;
}

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function toCandidate(track: TrackRow, source: 'library' | 'similar' | 'discovery'): CandidateTrack {
  const genres: string[] = track.genre_cluster ? [track.genre_cluster] : [];
  return {
    trackId: String(track.id),
    name: track.name,
    artist: track.artist,
    year: null,
    genres,
    source,
  };
}

/**
 * Build a candidate pool of 40–60 tracks for the LLM curator.
 *
 * Three buckets:
 *   library   — from the existing getCandidates() (respects locks + proximity)
 *   similar   — same-genre tracks not in library bucket
 *   discovery — different-genre tracks, biased toward never/rarely played
 *
 * Ratios are set by the user's discoveryAppetite, then adjusted by genreOpenness steering.
 */
export function buildCuratorPool(
  sessionId: number,
  appetite: DiscoveryAppetite,
  recentTrackIds: Set<number>,
  recentArtists: Set<string>,
): CandidateTrack[] {
  const steering = loadSteeringControls();
  const stateVector = stateVectorManager.getState(sessionId);
  const targetGenre = selector.getTargetGenre();
  const targetArtist = selector.getTargetArtist();

  // Build scoring context for getCandidates
  const scoringContext = {
    stateVector: stateVector ?? {
      energy: 0.5, valence: 0.5, tempo: 120,
      genreCluster: null, genreCounts: new Map(),
      familiarity: 0.5, vocalness: 0.5,
      aggressiveness: 0.3, context: 'unknown', fatigueLevel: 0,
    },
    steering,
    recentTrackIds: [...recentTrackIds],
    recentArtists: [...recentArtists],
    sessionSkipCount: 0,
    sessionTrackCount: 0,
    targetGenre: targetGenre ?? undefined,
    targetArtist: targetArtist ?? undefined,
  };

  const libraryRows = getCandidates(scoringContext);
  const libraryIds = new Set(libraryRows.map((t) => t.id));

  // ── Discovery ratios ────────────────────────────────────────────────
  const [libRatio, simRatio, discRatio] = adjustRatiosForSteering(
    APPETITE_RATIOS[appetite],
    steering.genreOpenness,
  );

  const targetTotal = POOL_TARGET_MIN + Math.floor(Math.random() * (POOL_TARGET_MAX - POOL_TARGET_MIN + 1));
  const libTarget = Math.round(targetTotal * libRatio);
  const simTarget = Math.round(targetTotal * simRatio);
  const discTarget = targetTotal - libTarget - simTarget;

  // ── Library bucket ──────────────────────────────────────────────────
  const libraryBucket = shuffled(libraryRows)
    .slice(0, libTarget)
    .map((t) => toCandidate(t, 'library'));

  // ── All tracks for similar/discovery buckets ───────────────────────
  const allTracks = getTracksWithFeatures();
  const currentGenre = targetGenre ?? stateVector?.genreCluster ?? null;

  const recentArtistSet = new Set([...recentArtists].map((a) => a.toLowerCase()));

  const notInLibrary = allTracks.filter(
    (t) =>
      !libraryIds.has(t.id) &&
      !recentTrackIds.has(t.id) &&
      t.energy !== null &&
      t.valence !== null,
  );

  // Similar: same genre as current state, not same artist as very recent
  const similarRows = notInLibrary.filter(
    (t) =>
      currentGenre && t.genre_cluster === currentGenre &&
      !recentArtistSet.has(t.artist.toLowerCase()),
  );

  // Discovery: different genre (or no genre match), bias toward low play count
  const discoveryFiltered = notInLibrary.filter(
    (t) => !currentGenre || t.genre_cluster !== currentGenre,
  );
  // Pre-fetch play counts to avoid O(n log n) DB reads inside sort comparator
  const playCountById = new Map<number, number>();
  for (const t of discoveryFiltered) {
    playCountById.set(t.id, getPreference(t.id)?.play_count ?? 0);
  }
  const discoveryRows = discoveryFiltered.sort(
    (a, b) => (playCountById.get(a.id) ?? 0) - (playCountById.get(b.id) ?? 0),
  );

  const similarBucket = shuffled(similarRows).slice(0, simTarget).map((t) => toCandidate(t, 'similar'));
  const discoveryBucket = discoveryRows.slice(0, discTarget).map((t) => toCandidate(t, 'discovery'));

  const pool = [...libraryBucket, ...similarBucket, ...discoveryBucket];

  // Pad with more library tracks if pool is under minimum
  if (pool.length < POOL_TARGET_MIN && libraryRows.length > libTarget) {
    const poolIds = new Set(pool.map((t) => t.trackId));
    const extras = libraryRows
      .filter((t) => !poolIds.has(String(t.id)))
      .slice(0, POOL_TARGET_MIN - pool.length)
      .map((t) => toCandidate(t, 'library'));
    pool.push(...extras);
  }

  logger.debug(
    {
      library: libraryBucket.length,
      similar: similarBucket.length,
      discovery: discoveryBucket.length,
      total: pool.length,
      appetite,
      ratios: `${Math.round(libRatio * 100)}/${Math.round(simRatio * 100)}/${Math.round(discRatio * 100)}`,
    },
    'Curator pool built',
  );

  return pool;
}
