import type { TrackRow } from '../database/types.js';

/**
 * Greedy nearest-neighbor ordering by transition cost. The first item stays first.
 */
export function greedyNearestNeighbor<T extends { track: TrackRow }>(items: T[]): T[] {
  if (items.length <= 1) return items;

  const ordered = [items[0]];
  const remaining = new Set(items.slice(1));

  while (remaining.size > 0) {
    const last = ordered[ordered.length - 1].track;
    let best: T | null = null;
    let bestCost = Infinity;

    for (const candidate of remaining) {
      const cost = transitionCost(last, candidate.track);
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
    }

    if (best) {
      ordered.push(best);
      remaining.delete(best);
    }
  }

  return ordered;
}

export function transitionCost(a: TrackRow, b: TrackRow): number {
  const bpmDelta = Math.abs((a.tempo ?? 120) - (b.tempo ?? 120)) / Math.max(1, a.tempo ?? 120);
  const energyDelta = Math.abs((a.energy ?? 0.5) - (b.energy ?? 0.5));
  const valenceDelta = Math.abs((a.valence ?? 0.5) - (b.valence ?? 0.5));
  const keyDelta = (a.key != null && b.key != null && a.key !== b.key) ? 0.3 : 0;
  return bpmDelta + energyDelta + valenceDelta + keyDelta;
}
