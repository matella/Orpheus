import { getCandidates } from './candidate-pool.js';
import { selector } from './selector.js';
import { stateVectorManager } from './state-vector.js';
import { loadSteeringControls } from './steering.js';
import { getTracksWithFeatures } from '../database/repositories/track.repo.js';
import { getPreference } from '../database/repositories/preference.repo.js';
import { getTopArtists } from '../database/repositories/top-artists.repo.js';
import { getRecommendations } from '../spotify/recommendations.js';
import type { SpotifyRecommendedTrack } from '../spotify/recommendations.js';
import { getDb } from '../database/connection.js';
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

function fromSpotifyRec(
  t: SpotifyRecommendedTrack,
  source: 'similar' | 'discovery',
): CandidateTrack {
  return {
    trackId: t.spotifyId,
    name: t.name,
    artist: t.artist,
    year: null,
    genres: [],
    source,
    spotifyUri: t.spotifyUri,
    artistId: t.artistId,
    album: t.album ?? undefined,
    durationMs: t.durationMs,
    popularity: t.popularity,
  };
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
 *   similar   — Spotify recommendations seeded by current track/artist, fallback to DB genre match
 *   discovery — Spotify recommendations seeded by diverse top artists, fallback to DB different-genre
 *
 * Ratios are set by the user's discoveryAppetite, then adjusted by genreOpenness steering.
 */
export async function buildCuratorPool(
  sessionId: number,
  appetite: DiscoveryAppetite,
  recentTrackIds: Set<number>,
  recentArtists: Set<string>,
  currentTrack?: { spotifyId: string } | null,
): Promise<CandidateTrack[]> {
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

  // Build set of all known Spotify IDs so we can exclude library tracks from Spotify results
  const existingSpotifyIds = new Set(
    (getDb().prepare('SELECT spotify_id FROM tracks').all() as { spotify_id: string }[]).map(
      (r) => r.spotify_id,
    ),
  );

  // ── Similar bucket — Spotify recommendations seeded by current track/artist, fallback to local DB ──
  let similarBucket: CandidateTrack[];
  if (currentTrack) {
    const currentRow = getDb()
      .prepare('SELECT artist_id FROM tracks WHERE spotify_id = ?')
      .get(currentTrack.spotifyId) as { artist_id: string | null } | undefined;
    const artistId = currentRow?.artist_id ?? null;

    const simRecs = await getRecommendations({
      seedTrackIds: [currentTrack.spotifyId],
      seedArtistIds: artistId ? [artistId] : [],
      targetEnergy: stateVector?.energy,
      targetValence: stateVector?.valence,
      limit: simTarget + 10,
    });

    const simFiltered = simRecs.filter(
      (t) =>
        !existingSpotifyIds.has(t.spotifyId) &&
        !recentArtistSet.has(t.artist.toLowerCase()),
    );

    if (simFiltered.length > 0) {
      similarBucket = simFiltered.slice(0, simTarget).map((t) => fromSpotifyRec(t, 'similar'));
    } else {
      const similarRows = currentGenre
        ? notInLibrary.filter(
            (t) => t.genre_cluster === currentGenre && !recentArtistSet.has(t.artist.toLowerCase()),
          )
        : notInLibrary.filter((t) => !recentArtistSet.has(t.artist.toLowerCase()));
      similarBucket = shuffled(similarRows).slice(0, simTarget).map((t) => toCandidate(t, 'similar'));
    }
  } else {
    const similarRows = currentGenre
      ? notInLibrary.filter(
          (t) => t.genre_cluster === currentGenre && !recentArtistSet.has(t.artist.toLowerCase()),
        )
      : notInLibrary.filter((t) => !recentArtistSet.has(t.artist.toLowerCase()));
    similarBucket = shuffled(similarRows).slice(0, simTarget).map((t) => toCandidate(t, 'similar'));
  }

  // ── Discovery bucket — Spotify recommendations seeded by diverse top artists, fallback to local DB ──
  let discoveryBucket: CandidateTrack[];
  const topArtistRows = getTopArtists('short_term', 10);
  const diverseArtistIds = topArtistRows
    .slice(0, 3)
    .map((a) => a.spotify_id)
    .filter((id): id is string => Boolean(id));

  if (discTarget > 0 && diverseArtistIds.length > 0) {
    const discRecs = await getRecommendations({
      seedArtistIds: diverseArtistIds,
      limit: discTarget + 10,
    });

    const discFiltered = discRecs.filter(
      (t) =>
        !existingSpotifyIds.has(t.spotifyId) &&
        !recentArtistSet.has(t.artist.toLowerCase()),
    );

    if (discFiltered.length > 0) {
      discoveryBucket = discFiltered.slice(0, discTarget).map((t) => fromSpotifyRec(t, 'discovery'));
    } else {
      const discoveryFiltered = notInLibrary.filter(
        (t) => !currentGenre || t.genre_cluster !== currentGenre,
      );
      const playCountById = new Map<number, number>();
      for (const t of discoveryFiltered) {
        playCountById.set(t.id, getPreference(t.id)?.play_count ?? 0);
      }
      const discoveryRows = discoveryFiltered.sort(
        (a, b) => (playCountById.get(a.id) ?? 0) - (playCountById.get(b.id) ?? 0),
      );
      discoveryBucket = discoveryRows.slice(0, discTarget).map((t) => toCandidate(t, 'discovery'));
    }
  } else {
    // no seeds or no target — fall straight to DB fallback
    discoveryBucket = []; // will be padded by library fallback at end if needed
  }

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
