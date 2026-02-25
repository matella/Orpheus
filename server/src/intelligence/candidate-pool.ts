import type { TrackRow } from '../database/types.js';
import { getTracksWithFeatures } from '../database/repositories/track.repo.js';
import {
  BPM_PROXIMITY_THRESHOLD,
  ENERGY_PROXIMITY_THRESHOLD,
  SAME_ARTIST_LOOKBACK,
} from '../shared/constants.js';
import { logger } from '../shared/logger.js';
import type { ScoringContext } from './types.js';

/**
 * Pre-filter the full track library down to a candidate pool before scoring.
 *
 * Applies exclusion rules (recently played, same artist) and proximity filters
 * (BPM, energy) relative to the current state vector. Falls back to relaxed
 * thresholds or no proximity filter if the pool would be too small.
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

  // Apply proximity filters at the given thresholds
  const applyProximity = (
    tracks: TrackRow[],
    bpmThreshold: number,
    energyThreshold: number,
  ): TrackRow[] =>
    tracks.filter((track) => {
      const bpmDelta =
        Math.abs(track.tempo! - context.stateVector.tempo) /
        context.stateVector.tempo;
      const energyDelta = Math.abs(
        track.energy! - context.stateVector.energy,
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

  logger.debug(
    { total: allTracks.length, candidates: candidates.length },
    'Candidate pool built',
  );

  return candidates;
}
