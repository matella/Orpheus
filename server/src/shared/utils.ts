/**
 * Cosine similarity between two numeric arrays.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Normalize a value to [0, 1] range.
 */
export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return clamp((value - min) / (max - min), 0, 1);
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Weighted random selection from items with corresponding weights.
 * Higher weight = higher probability of selection.
 */
export function weightedRandom<T>(items: T[], weights: number[]): T {
  if (items.length === 0) throw new Error('Cannot select from empty array');
  if (items.length === 1) return items[0];

  const totalWeight = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (totalWeight === 0) return items[Math.floor(Math.random() * items.length)];

  let random = Math.random() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    random -= Math.max(0, weights[i]);
    if (random <= 0) return items[i];
  }

  return items[items.length - 1];
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
