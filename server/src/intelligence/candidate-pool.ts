import type { TrackRow } from '../database/types.js';
import { getTracksWithFeatures } from '../database/repositories/track.repo.js';
import { getPreference } from '../database/repositories/preference.repo.js';
import {
  BPM_PROXIMITY_THRESHOLD,
  ENERGY_PROXIMITY_THRESHOLD,
  SAME_ARTIST_LOOKBACK,
} from '../shared/constants.js';
import { logger } from '../shared/logger.js';
import type { ScoringContext } from './types.js';

const DISCOVERY_POOL_FRACTION = 0.15;

/**
 * Pre-filter the full track library down to a candidate pool before scoring.
 *
 * Applies exclusion rules (recently played, same artist) and proximity filters
 * (BPM, energy) relative to the steering-adjusted target state. Falls back to
 * relaxed thresholds or no proximity filter if the pool would be too small.
 */
export function getCandidates(context: ScoringContext): TrackRow[] {
  const allTracks = getTracksWithFeatures();

  // Set of recently played track IDs for O(1) lookup
  const recentIdSet = new Set(context.recentTrackIds);

  // Only the first N recent artists count for the same-artist exclusion
  // Normalize to lowercase for consistent matching
  const recentArtistSet = new Set(
    context.recentArtists.slice(0, SAME_ARTIST_LOOKBACK).map((a) => a.toLowerCase()),
  );

  // When artist is locked, bypass same-artist exclusion for the target artist
  const targetArtist = context.targetArtist;
  const targetArtistLower = targetArtist?.toLowerCase() ?? null;

  // Base filter: exclusion + feature completeness
  const baseCandidates = allTracks.filter((track) => {
    // Exclude recently played
    if (recentIdSet.has(track.id)) return false;

    // Exclude same-artist within lookback (but exempt locked artist)
    const trackArtistLower = track.artist.toLowerCase();
    if (recentArtistSet.has(trackArtistLower)) {
      if (!targetArtistLower || trackArtistLower !== targetArtistLower) {
        return false;
      }
    }

    // Must have the core audio features
    if (track.energy === null || track.valence === null || track.tempo === null) {
      return false;
    }

    return true;
  });

  // Compute steering-adjusted targets so proximity filtering respects user intent.
  // Without this, steering energy to 0.9 while current state is 0.3 would only
  // return candidates near 0.3, making steering ineffective.
  const targetEnergy = context.stateVector.energy * 0.6 + context.steering.energy * 0.4;
  const targetTempo = context.stateVector.tempo;

  // Apply proximity filters at the given thresholds, using steering-adjusted targets
  const applyProximity = (
    tracks: TrackRow[],
    bpmThreshold: number,
    energyThreshold: number,
  ): TrackRow[] =>
    tracks.filter((track) => {
      const bpmDelta =
        Math.abs(track.tempo! - targetTempo) /
        Math.max(1, targetTempo);
      const energyDelta = Math.abs(
        track.energy! - targetEnergy,
      );
      return bpmDelta <= bpmThreshold && energyDelta <= energyThreshold;
    });

  // ---- Artist-aware pre-filter ----
  // When artist is locked, prefer tracks by that artist before genre filtering.
  let artistFilteredBase = baseCandidates;
  if (targetArtistLower) {
    const sameArtist = baseCandidates.filter(
      (t) => t.artist.toLowerCase() === targetArtistLower,
    );
    if (sameArtist.length >= 5) {
      // Enough same-artist tracks — use them as the base for genre filtering
      artistFilteredBase = sameArtist;
      logger.debug(
        { targetArtist, count: sameArtist.length },
        'Artist lock: using same-artist candidates as base',
      );
    } else {
      logger.debug(
        { targetArtist, count: sameArtist.length },
        'Artist lock: not enough same-artist tracks, will score artist match instead',
      );
    }
  }

  // ---- Genre-aware tiered filtering ----
  // When the session has a dominant genre (or an explicit target genre),
  // prefer same-genre candidates before falling back to cross-genre.
  const referenceGenre = context.targetGenre || context.stateVector.genreCluster;

  const sameGenre = referenceGenre
    ? artistFilteredBase.filter((t) => t.genre_cluster === referenceGenre)
    : [];

  // Try strict proximity within same-genre first
  let candidates = referenceGenre && sameGenre.length >= 10
    ? applyProximity(sameGenre, BPM_PROXIMITY_THRESHOLD, ENERGY_PROXIMITY_THRESHOLD)
    : [];

  if (candidates.length < 10 && referenceGenre && sameGenre.length >= 10) {
    // Relax proximity but keep genre lock
    candidates = applyProximity(sameGenre, BPM_PROXIMITY_THRESHOLD * 2, ENERGY_PROXIMITY_THRESHOLD * 2);
  }

  if (candidates.length < 10 && sameGenre.length >= 10) {
    // Drop proximity, keep genre
    candidates = sameGenre;
  }

  if (candidates.length < 10) {
    // Fall back: artist-filtered base (if applicable), all genres, strict proximity
    logger.debug(
      { sameGenre: sameGenre.length, genreLocked: candidates.length, referenceGenre },
      'Not enough same-genre candidates, falling back to all genres',
    );
    candidates = applyProximity(
      artistFilteredBase,
      BPM_PROXIMITY_THRESHOLD,
      ENERGY_PROXIMITY_THRESHOLD,
    );
  }

  if (candidates.length < 10) {
    // Relax: double both thresholds, artist-filtered base
    candidates = applyProximity(
      artistFilteredBase,
      BPM_PROXIMITY_THRESHOLD * 2,
      ENERGY_PROXIMITY_THRESHOLD * 2,
    );
  }

  if (candidates.length < 10) {
    // Drop proximity, keep artist filter if applicable
    candidates = artistFilteredBase;
  }

  if (candidates.length < 10 && artistFilteredBase !== baseCandidates) {
    // Artist lock yielded too few — fall back to full library
    logger.debug(
      { artistFiltered: artistFilteredBase.length },
      'Artist-filtered pool too small, falling back to full library',
    );
    candidates = applyProximity(
      baseCandidates,
      BPM_PROXIMITY_THRESHOLD * 2,
      ENERGY_PROXIMITY_THRESHOLD * 2,
    );
  }

  if (candidates.length < 10) {
    // Last resort: no proximity filter at all
    logger.debug(
      { relaxed: candidates.length },
      'Candidate pool still too small, removing proximity filters',
    );
    candidates = baseCandidates;
  }

  // Discovery injection: ensure some never-played tracks are in the pool
  const desiredDiscovery = Math.max(2, Math.ceil(candidates.length * DISCOVERY_POOL_FRACTION));
  const candidateIdSet = new Set(candidates.map((t) => t.id));

  const discoveryInPool = candidates.filter((t) => {
    const pref = getPreference(t.id);
    return !pref || pref.play_count === 0;
  }).length;

  if (discoveryInPool < desiredDiscovery) {
    // Source discovery from relaxed-proximity pool (not unfiltered base)
    // to prevent injecting tracks from distant genres/energy ranges
    const relaxedPool = applyProximity(
      baseCandidates,
      BPM_PROXIMITY_THRESHOLD * 2,
      ENERGY_PROXIMITY_THRESHOLD * 2,
    );
    const neverPlayed = relaxedPool.filter((t) => {
      if (candidateIdSet.has(t.id)) return false;
      const pref = getPreference(t.id);
      return !pref || pref.play_count === 0;
    });

    // Shuffle and pick random discovery candidates
    for (let i = neverPlayed.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [neverPlayed[i], neverPlayed[j]] = [neverPlayed[j], neverPlayed[i]];
    }

    const toAdd = Math.min(neverPlayed.length, desiredDiscovery - discoveryInPool);
    if (toAdd > 0) {
      candidates.push(...neverPlayed.slice(0, toAdd));
      logger.debug(
        { injected: toAdd, totalDiscovery: discoveryInPool + toAdd },
        'Discovery candidates injected into pool',
      );
    }
  }

  logger.debug(
    { total: allTracks.length, candidates: candidates.length, targetEnergy: targetEnergy.toFixed(2) },
    'Candidate pool built',
  );

  return candidates;
}
