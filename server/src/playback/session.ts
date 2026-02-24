import { logger } from '../shared/logger.js';
import {
  createSession,
  endSession as endDbSession,
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
    // End any stale session
    const existing = getActiveSession();
    if (existing) {
      logger.warn({ id: existing.id }, 'Ending stale session before starting new one');
      endDbSession(existing.id);
    }

    const sessionId = createSession(data);
    this.activeSessionId = sessionId;
    logger.info({ sessionId, device: data.deviceName }, 'Session started');
    return sessionId;
  }

  /**
   * End the current session.
   */
  end(stats?: {
    trackCount?: number;
    totalDurationMs?: number;
    avgEnergy?: number;
    avgValence?: number;
  }): void {
    if (this.activeSessionId === null) return;

    endDbSession(this.activeSessionId, stats);
    logger.info({ sessionId: this.activeSessionId, ...stats }, 'Session ended');
    this.activeSessionId = null;
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
