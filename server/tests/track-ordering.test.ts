import { describe, it, expect } from 'vitest';
import type { TrackRow } from '../src/database/types.js';
import { greedyNearestNeighbor, transitionCost } from '../src/intelligence/track-ordering.js';

const t = (id: number, energy: number, tempo = 120): TrackRow =>
  ({ id, energy, tempo, valence: 0.5, key: null } as unknown as TrackRow);

describe('track ordering', () => {
  it('transitionCost is 0 for identical tracks', () => {
    expect(transitionCost(t(1, 0.5), t(2, 0.5))).toBe(0);
  });

  it('greedyNearestNeighbor keeps the first item and chains closest energies', () => {
    const items = [t(1, 0.1), t(2, 0.9), t(3, 0.2), t(4, 0.8)].map((track) => ({ track }));
    expect(greedyNearestNeighbor(items).map((i) => i.track.id)).toEqual([1, 3, 4, 2]);
  });
});
