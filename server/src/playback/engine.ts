import { EventEmitter } from 'node:events';
import { logger } from '../shared/logger.js';
import { PLAYER_POLL_INTERVAL_MS } from '../shared/constants.js';
import { sleep } from '../shared/utils.js';
import { getPlayerState } from '../spotify/player.js';
import { playTrack, addToQueue } from '../spotify/player.js';
import { getRandomTracks, getTrackBySpotifyId } from '../database/repositories/track.repo.js';
import { recordInteraction } from '../database/repositories/interaction.repo.js';
import { selector } from '../intelligence/selector.js';
import { stateVectorManager } from '../intelligence/state-vector.js';
import { learnTimePreferences } from '../intelligence/context-learning.js';
import { generateSessionName } from '../ai/service.js';
import { recordPlay } from '../database/repositories/preference.repo.js';
import { TrackQueue } from './queue.js';
import { SessionManager } from './session.js';
import { toPlaybackTrack } from './types.js';
import type { PlaybackTrack, EngineState } from './types.js';

/**
 * Events emitted by the playback engine.
 */
export interface EngineEvents {
  track_changed: { current: PlaybackTrack; next: PlaybackTrack | null };
  session_started: { sessionId: number; deviceName: string | null };
  session_ended: { sessionId: number; trackCount: number };
  state_updated: { state: EngineState };
}

/**
 * The core playback engine.
 *
 * Core loop: poll Spotify player state → detect track changes →
 * advance queue → select next track → repeat.
 *
 * Uses the intelligence engine for scored track selection when a
 * session is active, with a random fallback otherwise.
 */
class PlaybackEngine extends EventEmitter {
  private queue = new TrackQueue();
  private session = new SessionManager();
  private status: 'idle' | 'running' | 'paused' | 'stopping' = 'idle';
  private deviceId: string | null = null;
  private deviceName: string | null = null;
  private currentTrackSpotifyId: string | null = null;
  private trackCount = 0;
  private startedAt: string | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private trackStartTime: number | null = null;

  /**
   * Start the engine for a given device.
   * @param autoStarted Whether this was triggered by the scheduler (true) or manually (false).
   */
  async start(deviceId: string, deviceName?: string, autoStarted: boolean = true): Promise<void> {
    if (this.status === 'running') {
      logger.warn('Engine already running');
      return;
    }

    this.deviceId = deviceId;
    this.deviceName = deviceName ?? null;
    this.status = 'running';
    this.trackCount = 0;
    this.startedAt = new Date().toISOString();

    // Infer context before starting session
    const inferredState = stateVectorManager.inferInitialState();
    const initialContext = inferredState.context;

    // Start a session
    const sessionId = this.session.start({
      deviceId,
      deviceName,
      initialContext,
      autoStarted,
    });

    this.emit('session_started', { sessionId, deviceName: this.deviceName });
    selector.initSession(sessionId);
    logger.info({ deviceId, deviceName, initialContext }, 'Playback engine started');

    // Select and play the first track
    await this.selectAndPlayInitial();

    // Start the polling loop
    this.runLoop();
  }

  /**
   * Stop the engine and end the session.
   */
  stop(): void {
    if (this.status === 'idle') return;

    this.status = 'stopping';
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }

    const sessionId = this.session.getSessionId();
    if (sessionId) {
      // Learn time-of-day preferences from this session's state trajectory
      learnTimePreferences(sessionId);
      selector.endSession(sessionId);
    }
    this.session.end({ trackCount: this.trackCount });

    // Fire-and-forget AI session name generation
    if (sessionId) {
      generateSessionName(sessionId).catch(() => {
        // Silently ignore — AI naming is best-effort
      });
    }

    if (sessionId) {
      this.emit('session_ended', { sessionId, trackCount: this.trackCount });
    }

    this.queue.clear();
    this.currentTrackSpotifyId = null;
    this.deviceId = null;
    this.deviceName = null;
    this.trackCount = 0;
    this.startedAt = null;
    this.trackStartTime = null;
    this.status = 'idle';

    logger.info('Playback engine stopped');
    this.emitState();
  }

  /**
   * Skip the current track.
   */
  async skip(): Promise<void> {
    if (this.status !== 'running') return;

    const current = this.queue.getCurrent();
    if (current) {
      const listenDuration = this.trackStartTime ? Date.now() - this.trackStartTime : 0;
      recordInteraction({
        trackId: current.id,
        sessionId: this.session.getSessionId() ?? undefined,
        interactionType: 'skip',
        listenDurationMs: listenDuration,
        completionRatio: current.durationMs > 0 ? listenDuration / current.durationMs : 0,
        skipPositionMs: listenDuration,
      });

      // Notify intelligence engine of skip
      const sessionId = this.session.getSessionId();
      if (sessionId) {
        selector.onInteraction({
          track_id: current.id,
          interaction_type: 'skip',
          listen_duration_ms: listenDuration,
          completion_ratio: current.durationMs > 0 ? listenDuration / current.durationMs : 0,
        });
      }
    }

    // Advance the queue
    this.queue.advance();
    const next = this.queue.getCurrent();

    if (next) {
      await playTrack(next.uri, this.deviceId ?? undefined);
      this.currentTrackSpotifyId = next.spotifyId;
      this.trackStartTime = Date.now();
      this.trackCount++;
      this.session.recordTrack(0);

      recordPlay(next.id);
      recordInteraction({
        trackId: next.id,
        sessionId: this.session.getSessionId() ?? undefined,
        interactionType: 'play',
      });

      this.emit('track_changed', { current: next, next: this.queue.peekNext() });
      this.emitState();
    }

    // Fill the queue
    await this.fillQueue();
  }

  /**
   * Get the current engine state.
   */
  getState(): EngineState {
    return {
      status: this.status,
      sessionId: this.session.getSessionId(),
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      currentTrackSpotifyId: this.currentTrackSpotifyId,
      trackCount: this.trackCount,
      startedAt: this.startedAt,
    };
  }

  /**
   * Get the current and next tracks.
   */
  getCurrentTrack(): PlaybackTrack | null {
    return this.queue.getCurrent();
  }

  getNextTrack(): PlaybackTrack | null {
    return this.queue.peekNext();
  }

  isRunning(): boolean {
    return this.status === 'running';
  }

  // --- Internal ---

  private async selectAndPlayInitial(): Promise<void> {
    const track = this.selectNextTrack();
    if (!track) {
      logger.error('No tracks available in library. Cannot start playback.');
      this.stop();
      return;
    }

    this.queue.setCurrent(track);
    this.currentTrackSpotifyId = track.spotifyId;
    this.trackStartTime = Date.now();
    this.trackCount = 1;

    try {
      await playTrack(track.uri, this.deviceId ?? undefined);
    } catch (err) {
      logger.error({ err, track: track.name }, 'Failed to start playback');
      this.stop();
      return;
    }

    // Record play
    recordPlay(track.id);
    recordInteraction({
      trackId: track.id,
      sessionId: this.session.getSessionId() ?? undefined,
      interactionType: 'play',
    });

    // Notify intelligence of first track
    const sessionId = this.session.getSessionId();
    if (sessionId) {
      const trackRow = getTrackBySpotifyId(track.spotifyId);
      if (trackRow) {
        selector.onTrackPlayed(sessionId, trackRow);
      }
    }

    // Fill the rest of the queue
    await this.fillQueue();

    this.emit('track_changed', {
      current: track,
      next: this.queue.peekNext(),
    });
    this.emitState();
  }

  private async fillQueue(): Promise<void> {
    if (this.queue.needsNext()) {
      const next = this.selectNextTrack();
      if (next) {
        this.queue.setNext(next);
        // Queue the track on Spotify so it plays after current
        try {
          await addToQueue(next.uri, this.deviceId ?? undefined);
        } catch (err) {
          logger.warn({ err, track: next.name }, 'Failed to add next track to Spotify queue');
        }
      }
    }

    if (this.queue.needsBuffer()) {
      const buffer = this.selectNextTrack();
      if (buffer) {
        this.queue.setBuffer(buffer);
      }
    }
  }

  /**
   * Select the next track to play using the intelligence engine.
   * Falls back to random selection if no session is active.
   */
  private selectNextTrack(): PlaybackTrack | null {
    const sessionId = this.session.getSessionId();
    if (!sessionId) {
      // Fallback to random if no session
      const rows = getRandomTracks(1);
      return rows.length > 0 ? toPlaybackTrack(rows[0]) : null;
    }
    const selected = selector.selectNextTrack(sessionId);
    return selected ? toPlaybackTrack(selected) : null;
  }

  /**
   * The main polling loop.
   */
  private runLoop(): void {
    if (this.status !== 'running') return;

    this.loopTimer = setTimeout(async () => {
      try {
        await this.pollAndProcess();
      } catch (err) {
        logger.error({ err }, 'Playback loop error');
      }
      this.runLoop(); // Schedule next iteration
    }, PLAYER_POLL_INTERVAL_MS);
  }

  private async pollAndProcess(): Promise<void> {
    const playerState = await getPlayerState();

    // No active player — stop the engine
    if (!playerState || !playerState.device) {
      logger.info('No active player detected, stopping engine');
      this.stop();
      return;
    }

    // Detect track change (user skipped externally or track ended naturally)
    if (playerState.track && playerState.track.id !== this.currentTrackSpotifyId) {
      await this.handleTrackChange(playerState.track.id, playerState.progressMs);
    }

    // If playback is not happening and we have a current track, check if we need to handle
    if (!playerState.isPlaying && this.status === 'running') {
      // Player is paused — keep the engine running but don't intervene
      // The user may have paused manually
    }
  }

  private async handleTrackChange(
    newSpotifyId: string,
    progressMs: number,
  ): Promise<void> {
    const previous = this.queue.getCurrent();

    if (previous) {
      const listenDuration = this.trackStartTime ? Date.now() - this.trackStartTime : 0;
      const completionRatio = previous.durationMs > 0
        ? Math.min(1, listenDuration / previous.durationMs)
        : 0;

      // Record completion (natural end or external skip)
      const wasSkipped = completionRatio < 0.8;
      recordInteraction({
        trackId: previous.id,
        sessionId: this.session.getSessionId() ?? undefined,
        interactionType: wasSkipped ? 'skip' : 'play',
        listenDurationMs: listenDuration,
        completionRatio,
        skipPositionMs: wasSkipped ? listenDuration : undefined,
      });
      this.session.recordTrack(listenDuration);

      // Notify intelligence engine of interaction
      const sessionId = this.session.getSessionId();
      if (sessionId) {
        selector.onInteraction({
          track_id: previous.id,
          interaction_type: wasSkipped ? 'skip' : 'play',
          listen_duration_ms: listenDuration,
          completion_ratio: completionRatio,
        });
      }
    }

    // Check if the new track is our expected next track
    const expectedNext = this.queue.peekNext();
    if (expectedNext && expectedNext.spotifyId === newSpotifyId) {
      // Natural transition to our queued track
      this.queue.advance();
    } else {
      // External change (user picked a different track) — just update current
      // We don't have the full TrackRow for this external track, but we track the ID
      logger.debug({ newSpotifyId }, 'External track change detected');
    }

    this.currentTrackSpotifyId = newSpotifyId;
    this.trackStartTime = Date.now();
    this.trackCount++;

    const current = this.queue.getCurrent();
    if (current) {
      recordPlay(current.id);
    }

    // Notify intelligence of the new track
    const sessionId = this.session.getSessionId();
    if (sessionId) {
      const trackRow = getTrackBySpotifyId(newSpotifyId);
      if (trackRow) {
        selector.onTrackPlayed(sessionId, trackRow);
      }
    }

    // Fill queue with new tracks
    await this.fillQueue();

    if (current) {
      this.emit('track_changed', { current, next: this.queue.peekNext() });
    }
    this.emitState();
  }

  private emitState(): void {
    this.emit('state_updated', { state: this.getState() });
  }
}

// Singleton engine instance
export const engine = new PlaybackEngine();
