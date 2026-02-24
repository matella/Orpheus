import type { PlaybackTrack } from './types.js';
import { logger } from '../shared/logger.js';

/**
 * Manages a 3-track buffer: current, next, and buffer.
 * Ensures there's always a track ready to play.
 */
export class TrackQueue {
  private current: PlaybackTrack | null = null;
  private next: PlaybackTrack | null = null;
  private buffer: PlaybackTrack | null = null;

  /**
   * Get the currently playing track.
   */
  getCurrent(): PlaybackTrack | null {
    return this.current;
  }

  /**
   * Peek at the next track without advancing.
   */
  peekNext(): PlaybackTrack | null {
    return this.next;
  }

  /**
   * Peek at the buffer track.
   */
  peekBuffer(): PlaybackTrack | null {
    return this.buffer;
  }

  /**
   * Set the current track (used for initial playback start).
   */
  setCurrent(track: PlaybackTrack): void {
    this.current = track;
    logger.debug({ track: track.name, artist: track.artist }, 'Queue: set current');
  }

  /**
   * Set the next track.
   */
  setNext(track: PlaybackTrack): void {
    this.next = track;
    logger.debug({ track: track.name, artist: track.artist }, 'Queue: set next');
  }

  /**
   * Set the buffer track.
   */
  setBuffer(track: PlaybackTrack): void {
    this.buffer = track;
    logger.debug({ track: track.name, artist: track.artist }, 'Queue: set buffer');
  }

  /**
   * Advance the queue: current <- next, next <- buffer, buffer <- null.
   * Returns the new current track.
   */
  advance(): PlaybackTrack | null {
    const previous = this.current;
    this.current = this.next;
    this.next = this.buffer;
    this.buffer = null;

    if (this.current) {
      logger.info(
        { from: previous?.name, to: this.current.name },
        'Queue: advanced',
      );
    }

    return this.current;
  }

  /**
   * Check if the queue needs tracks filled.
   */
  needsNext(): boolean {
    return this.next === null;
  }

  needsBuffer(): boolean {
    return this.buffer === null;
  }

  /**
   * Check if the queue is empty (no current track).
   */
  isEmpty(): boolean {
    return this.current === null;
  }

  /**
   * Clear the entire queue.
   */
  clear(): void {
    this.current = null;
    this.next = null;
    this.buffer = null;
    logger.debug('Queue: cleared');
  }
}
