import type { PlaybackTrack } from './types.js';
import { logger } from '../shared/logger.js';

/**
 * Manages a dynamic track buffer: current + N lookahead tracks.
 *
 * The first two lookahead positions (next, buffer) are synced to Spotify's
 * queue. Remaining positions are internal pre-selections that can be
 * re-evaluated when AI weights change.
 *
 * Target lookahead size is driven by the AI analysis interval so the
 * intelligence pipeline always has enough pre-selected tracks for a
 * full analysis cycle.
 */
export class TrackQueue {
  private current: PlaybackTrack | null = null;
  private lookahead: PlaybackTrack[] = [];
  private _targetSize = 2; // default: next + buffer (same as old 3-slot queue)

  // ── Target size ──────────────────────────────────────────────────

  /**
   * Set the desired lookahead depth.
   * Clamped to a minimum of 2 (next + buffer).
   */
  setTargetSize(size: number): void {
    this._targetSize = Math.max(2, size);
  }

  getTargetSize(): number {
    return this._targetSize;
  }

  // ── Current track ────────────────────────────────────────────────

  getCurrent(): PlaybackTrack | null {
    return this.current;
  }

  setCurrent(track: PlaybackTrack): void {
    this.current = track;
    logger.debug({ track: track.name, artist: track.artist }, 'Queue: set current');
  }

  // ── Lookahead access ─────────────────────────────────────────────

  /** Peek at the next track (lookahead[0]) without advancing. */
  peekNext(): PlaybackTrack | null {
    return this.lookahead[0] ?? null;
  }

  /** Peek at the buffer track (lookahead[1]). */
  peekBuffer(): PlaybackTrack | null {
    return this.lookahead[1] ?? null;
  }

  /** Peek at any lookahead position. */
  peekAt(index: number): PlaybackTrack | null {
    return this.lookahead[index] ?? null;
  }

  /** Number of tracks currently in the lookahead. */
  getLookaheadSize(): number {
    return this.lookahead.length;
  }

  // ── Mutation ─────────────────────────────────────────────────────

  /** Set the next track (lookahead[0]). Replaces if already occupied. */
  setNext(track: PlaybackTrack): void {
    if (this.lookahead.length === 0) {
      this.lookahead.push(track);
    } else {
      this.lookahead[0] = track;
    }
    logger.debug({ track: track.name, artist: track.artist }, 'Queue: set next');
  }

  /** Append a track to the end of the lookahead. */
  pushLookahead(track: PlaybackTrack): void {
    this.lookahead.push(track);
    logger.debug(
      { track: track.name, artist: track.artist, position: this.lookahead.length - 1 },
      'Queue: pushed to lookahead',
    );
  }

  // ── Advance ──────────────────────────────────────────────────────

  /**
   * Advance the queue: current <- lookahead.shift().
   * Returns the new current track.
   */
  advance(): PlaybackTrack | null {
    const previous = this.current;
    this.current = this.lookahead.shift() ?? null;

    if (this.current) {
      logger.info(
        { from: previous?.name, to: this.current.name, remaining: this.lookahead.length },
        'Queue: advanced',
      );
    }

    return this.current;
  }

  // ── Status checks ────────────────────────────────────────────────

  needsNext(): boolean {
    return this.lookahead.length === 0;
  }

  /** Whether the lookahead has fewer tracks than the target. */
  needsFill(): boolean {
    return this.lookahead.length < this._targetSize;
  }

  isEmpty(): boolean {
    return this.current === null;
  }

  // ── Utility ──────────────────────────────────────────────────────

  /** Get all track IDs in the queue (current + lookahead) for exclusion. */
  getAllIds(): Set<number> {
    const ids = new Set<number>();
    if (this.current) ids.add(this.current.id);
    for (const t of this.lookahead) ids.add(t.id);
    return ids;
  }

  /** Clear the entire queue. */
  clear(): void {
    logger.info(
      {
        current: this.current ? `${this.current.name} (${this.current.artist})` : null,
        lookaheadSize: this.lookahead.length,
      },
      'Queue: clearing',
    );
    this.current = null;
    this.lookahead = [];
  }
}
