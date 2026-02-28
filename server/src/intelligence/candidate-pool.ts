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
  const recentArtistSet = new Set(
    context.recentArtists.slice(0, SAME_ARTIST_LOOKBACK),
  );

  // Base filter: exclusion + feature completeness
  const baseCandidates = allTracks.filter((track) => {
    // Exclude recently played
    if (recentIdSet.has(track.id)) return false;

    // Exclude same-artist within lookback
    if (recentArtistSet.has(track.artist)) return false;

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

  // Try strict thresholds first
  let candidates = applyProximity(
    baseCandidates,
    BPM_PROXIMITY_THRESHOLD,
    ENERGY_PROXIMITY_THRESHOLD,
  );

  if (candidates.length < 10) {
    // Relax: double both thresholds
    logger.debug(
      { strict: candidates.length },
      'Candidate pool too small, relaxing proximity thresholds',
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
