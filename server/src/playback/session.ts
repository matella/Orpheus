import { logger } from '../shared/logger.js';
import {
  createSession,
  endSession as endDbSession,
  deleteSession as deleteDbSession,
  getActiveSession,
  incrementTrackCount,
} from '../database/repositories/session.repo.js';

/**
 * Manages the lifecycle of a playback session.
 */
export class SessionManager {
  private activeSessionId: number | null = null;

  /**
   * Start a new session. Ends any existing active session first.
   */
  start(data: {
    deviceId?: string;
    deviceName?: string;
    initialContext?: string;
    autoStarted?: boolean;
  }): number {
    // Clean up any stale session
    const existing = getActiveSession();
    if (existing) {
      if (existing.track_count === 0) {
        logger.warn({ id: existing.id }, 'Deleting stale empty session before starting new one');
        deleteDbSession(existing.id);
      } else {
        logger.warn({ id: existing.id }, 'Ending stale session before starting new one');
        endDbSession(existing.id);
      }
    }

    const sessionId = createSession(data);
    this.activeSessionId = sessionId;
    logger.info({ sessionId, device: data.deviceName }, 'Session started');
    return sessionId;
  }

  /**
   * End the current session.
   * If the session has 0 tracks, deletes it entirely instead of persisting.
   * Returns true if the session was kept, false if it was deleted (empty).
   */
  end(stats?: {
    trackCount?: number;
    totalDurationMs?: number;
    avgEnergy?: number;
    avgValence?: number;
  }): boolean {
    if (this.activeSessionId === null) return false;

    const isEmpty = (stats?.trackCount ?? 0) === 0;

    if (isEmpty) {
      deleteDbSession(this.activeSessionId);
      logger.info({ sessionId: this.activeSessionId }, 'Empty session deleted (0 tracks)');
      this.activeSessionId = null;
      return false;
    }

    endDbSession(this.activeSessionId, stats);
    logger.info({ sessionId: this.activeSessionId, ...stats }, 'Session ended');
    this.activeSessionId = null;
    return true;
  }

  /**
   * Record that a track was played in the current session.
   */
  recordTrack(durationMs: number): void {
    if (this.activeSessionId === null) return;
    incrementTrackCount(this.activeSessionId, durationMs);
  }

  /**
   * Get the current session ID.
   */
  getSessionId(): number | null {
    return this.activeSessionId;
  }

  /**
   * Check if a session is active.
   */
  isActive(): boolean {
    return this.activeSessionId !== null;
  }
}
