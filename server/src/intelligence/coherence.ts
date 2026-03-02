import type { TrackRow } from '../database/types.js';
import {
  BPM_PROXIMITY_THRESHOLD,
  ENERGY_PROXIMITY_THRESHOLD,
} from '../shared/constants.js';
import { clamp } from '../shared/utils.js';
import { logger } from '../shared/logger.js';

export interface CoherenceResult {
  /** Overall coherence score 0-1 (average of per-track scores). */
  score: number;
  /** Tracks that are coherent with the anchor (per-track score >= 0.5). */
  coherentTracks: TrackRow[];
  /** Tracks that break coherence (per-track score < 0.5). */
  incoherentTracks: TrackRow[];
  details: {
    avgBpmDelta: number;
    avgEnergyDelta: number;
    genreMatchRatio: number;
    avgValenceDelta: number;
  };
}

/**
 * Analyze how coherent a set of queued tracks is relative to an anchor track.
 *
 * Uses the same proximity thresholds as candidate-pool.ts to stay consistent
 * with the intelligence pipeline's notion of musical similarity.
 *
 * Per-track scoring:
 *   - BPM proximity (30%): normalized delta vs BPM_PROXIMITY_THRESHOLD
 *   - Energy proximity (30%): normalized delta vs ENERGY_PROXIMITY_THRESHOLD
 *   - Genre match (40%): ternary — same cluster=1.0, both unknown=0.5, mismatch=0.0
 *
 * Returns score=1.0 for an empty queue (vacuously coherent).
 */
export function analyzeQueueCoherence(
  anchor: TrackRow,
  queueTracks: TrackRow[],
): CoherenceResult {
  if (queueTracks.length === 0) {
    return {
      score: 1.0,
      coherentTracks: [],
      incoherentTracks: [],
      details: { avgBpmDelta: 0, avgEnergyDelta: 0, genreMatchRatio: 1, avgValenceDelta: 0 },
    };
  }

  // If anchor is missing core audio features, we can't meaningfully assess
  // coherence — treat as incoherent to avoid false adoptions based on defaults.
  if (anchor.energy == null || anchor.tempo == null) {
    logger.warn(
      { anchorId: anchor.id, name: anchor.name },
      'Anchor track missing core features -- treating queue as incoherent',
    );
    return {
      score: 0.0,
      coherentTracks: [],
      incoherentTracks: queueTracks,
      details: { avgBpmDelta: 0, avgEnergyDelta: 0, genreMatchRatio: 0, avgValenceDelta: 0 },
    };
  }

  const anchorTempo = anchor.tempo;
  const anchorEnergy = anchor.energy;
  const anchorValence = anchor.valence ?? 0.5;
  const anchorGenre = anchor.genre_cluster;

  const coherent: TrackRow[] = [];
  const incoherent: TrackRow[] = [];
  let totalScore = 0;
  let totalBpmDelta = 0;
  let totalEnergyDelta = 0;
  let totalValenceDelta = 0;
  let genreMatches = 0;

  for (const track of queueTracks) {
    const trackTempo = track.tempo ?? 120;
    const trackEnergy = track.energy ?? 0.5;
    const trackValence = track.valence ?? 0.5;

    // BPM delta (relative to anchor)
    const bpmDelta = Math.abs(trackTempo - anchorTempo) / Math.max(1, anchorTempo);
    const bpmScore = 1 - clamp(bpmDelta / BPM_PROXIMITY_THRESHOLD, 0, 1);

    // Energy delta (absolute)
    const energyDelta = Math.abs(trackEnergy - anchorEnergy);
    const energyScore = 1 - clamp(energyDelta / ENERGY_PROXIMITY_THRESHOLD, 0, 1);

    // Genre match: same cluster = 1.0, both unknown = 0.5 (neutral), mismatch = 0.0
    const genreMatch =
      (!track.genre_cluster && !anchorGenre) ? 0.5 :
      (track.genre_cluster && anchorGenre && track.genre_cluster === anchorGenre) ? 1.0 : 0.0;
    if (genreMatch >= 1.0) genreMatches++;

    // Valence delta (tracked for details but not scored — genre/BPM/energy are the core axes)
    const valenceDelta = Math.abs(trackValence - anchorValence);

    // Weighted per-track score
    const trackScore = bpmScore * 0.3 + energyScore * 0.3 + genreMatch * 0.4;

    if (trackScore >= 0.5) {
      coherent.push(track);
    } else {
      incoherent.push(track);
    }

    totalScore += trackScore;
    totalBpmDelta += bpmDelta;
    totalEnergyDelta += energyDelta;
    totalValenceDelta += valenceDelta;
  }

  const n = queueTracks.length;
  const result: CoherenceResult = {
    score: totalScore / n,
    coherentTracks: coherent,
    incoherentTracks: incoherent,
    details: {
      avgBpmDelta: totalBpmDelta / n,
      avgEnergyDelta: totalEnergyDelta / n,
      genreMatchRatio: genreMatches / n,
      avgValenceDelta: totalValenceDelta / n,
    },
  };

  logger.info(
    {
      score: result.score.toFixed(3),
      coherent: coherent.length,
      incoherent: incoherent.length,
      ...result.details,
    },
    'Queue coherence analysis complete',
  );

  return result;
}
