import { EventEmitter } from 'node:events';
import { logger } from '../shared/logger.js';
import { PLAYER_POLL_INTERVAL_MS, QUEUE_COHERENCE_THRESHOLD, QUEUE_ANALYSIS_DEPTH } from '../shared/constants.js';
import { getPlayerState, getQueue } from '../spotify/player.js';
import { playTrack, addToQueue, drainQueue, skipToNext } from '../spotify/player.js';
import { getRandomTracks, getTrackBySpotifyId } from '../database/repositories/track.repo.js';
import { recordInteraction } from '../database/repositories/interaction.repo.js';
import { selector } from '../intelligence/selector.js';
import { stateVectorManager } from '../intelligence/state-vector.js';
import { learnTimePreferences } from '../intelligence/context-learning.js';
import { analyzeQueueCoherence } from '../intelligence/coherence.js';
import { generateSessionName, generateSessionRecap } from '../ai/service.js';
import { getAiSettings } from '../database/repositories/settings.repo.js';
import { recordPlay } from '../database/repositories/preference.repo.js';
import { TrackQueue } from './queue.js';
import { SessionManager } from './session.js';
import { toPlaybackTrack } from './types.js';
import type { PlaybackTrack, EngineState } from './types.js';

/**
 * Events emitted by the playback engine.
 */
export interface TrajectoryPoint {
  name: string;
  energy: number;
  valence: number;
  adopted: boolean;
}

export interface EngineEvents {
  track_changed: { current: PlaybackTrack; next: PlaybackTrack | null };
  session_started: { sessionId: number; deviceName: string | null };
  session_ended: { sessionId: number; trackCount: number };
  state_updated: { state: EngineState; current: PlaybackTrack | null; next: PlaybackTrack | null; trajectory: TrajectoryPoint[] };
  transition_complete: { adoptedTracks: number; coherenceScore: number | null };
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
  private lastProgressMs: number = 0;
  private injectedQueue: PlaybackTrack[] = [];
  private nextSyncedToSpotify = false;
  private bufferSyncedToSpotify = false;
  private skipInProgress = false;
  private transitionMode: 'none' | 'observing' | 'autonomous' = 'none';
  private adoptedTrackCount = 0;
  private coherenceScore: number | null = null;
  /** Consecutive polls where no active Spotify device was found. */
  private noDeviceCount = 0;
  /** Number of consecutive no-device polls before stopping the engine. */
  private static readonly NO_DEVICE_TOLERANCE = 3;

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
    this.noDeviceCount = 0;
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
    // Skip default state vector init — gracefulStartup() seeds it from actual tracks
    selector.initSession(sessionId, true);
    logger.info({ deviceId, deviceName, initialContext }, 'Playback engine started');

    // Attempt graceful startup (respects current playback)
    await this.gracefulStartup();

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
    const hasContent = this.trackCount > 0;

    // Record final track's listen duration before ending session
    const finalTrack = this.queue.getCurrent();
    if (finalTrack && this.trackStartTime) {
      const listenDuration = Date.now() - this.trackStartTime;
      recordInteraction({
        trackId: finalTrack.id,
        sessionId: sessionId ?? undefined,
        interactionType: 'play',
        listenDurationMs: listenDuration,
        completionRatio: finalTrack.durationMs > 0
          ? Math.min(1, listenDuration / finalTrack.durationMs)
          : 0,
      });
      this.session.recordTrack(listenDuration);
    }

    if (sessionId && hasContent) {
      // Learn time-of-day preferences from this session's state trajectory
      learnTimePreferences(sessionId);
      selector.endSession(sessionId);
    }

    // End (or delete if empty) the session
    const sessionKept = this.session.end({ trackCount: this.trackCount });

    // Fire-and-forget AI session name + recap only for non-empty sessions
    if (sessionId && sessionKept) {
      Promise.all([
        generateSessionName(sessionId),
        generateSessionRecap(sessionId),
      ]).catch((err) => {
        logger.debug({ err }, 'AI session recap/name generation failed (best-effort)');
      });

      this.emit('session_ended', { sessionId, trackCount: this.trackCount });
    }

    this.queue.clear();
    this.injectedQueue = [];
    this.nextSyncedToSpotify = false;
    this.bufferSyncedToSpotify = false;
    this.currentTrackSpotifyId = null;
    this.deviceId = null;
    this.deviceName = null;
    this.trackCount = 0;
    this.startedAt = null;
    this.trackStartTime = null;
    this.lastProgressMs = 0;
    this.transitionMode = 'none';
    this.adoptedTrackCount = 0;
    this.coherenceScore = null;
    this.noDeviceCount = 0;
    this.status = 'idle';

    logger.info('Playback engine stopped');
    this.emitState();
  }

  /**
   * Log a snapshot of the queue state for diagnostics.
   */
  private logQueueState(label: string): void {
    const current = this.queue.getCurrent();
    const next = this.queue.peekNext();
    const lookaheadNames: string[] = [];
    for (let i = 0; i < this.queue.getLookaheadSize(); i++) {
      const t = this.queue.peekAt(i);
      if (t) lookaheadNames.push(`${t.name} (${t.artist})`);
    }
    logger.info(
      {
        label,
        current: current ? `${current.name} (${current.artist})` : null,
        next: next ? `${next.name} (${next.artist})` : null,
        lookaheadSize: this.queue.getLookaheadSize(),
        targetSize: this.queue.getTargetSize(),
        lookahead: lookaheadNames,
        nextSynced: this.nextSyncedToSpotify,
        bufferSynced: this.bufferSyncedToSpotify,
        skipInProgress: this.skipInProgress,
      },
      `Queue state: ${label}`,
    );
  }

  /**
   * Skip the current track.
   * Guarded by skipInProgress to prevent double-tap races where two concurrent
   * skip() calls both advance the queue before either completes.
   */
  async skip(): Promise<void> {
    if (this.status !== 'running') return;
    if (this.skipInProgress) {
      logger.debug('skip() called while another skip is in progress -- ignoring');
      return;
    }
    this.skipInProgress = true;
    logger.info('skip() called');
    this.logQueueState('skip-entry');
    try {

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
      if (this.nextSyncedToSpotify) {
        // Track is already at the front of Spotify's user queue -- use skipToNext()
        // to consume it naturally. This avoids leaving a stale duplicate.
        logger.info({ strategy: 'skipToNext', track: next.name }, 'Skip strategy: synced -- using skipToNext()');
        await skipToNext();
        // Shift sync flags: buffer (if synced) is now the front of Spotify's queue
        this.nextSyncedToSpotify = this.bufferSyncedToSpotify;
        this.bufferSyncedToSpotify = false;
      } else {
        // Track was never synced to Spotify -- must force-play it.
        // Drain first to clear any stale entries.
        logger.info({ strategy: 'drainAndPlay', track: next.name }, 'Skip strategy: unsynced -- draining queue and force-playing');
        await drainQueue();
        await playTrack(next.uri, this.deviceId ?? undefined);
        this.nextSyncedToSpotify = false;
        this.bufferSyncedToSpotify = false;
      }
      this.currentTrackSpotifyId = next.spotifyId;
      this.trackStartTime = Date.now();
      this.lastProgressMs = 0; // Reset so the poll loop doesn't falsely detect a same-track restart
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

    // Check if skipping through adopted tracks completed the transition
    await this.checkTransition();

    this.logQueueState('skip-exit');
    logger.info('skip() complete');

    } finally {
      this.skipInProgress = false;
    }
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
      transitionMode: this.transitionMode,
      adoptedTrackCount: this.adoptedTrackCount,
      coherenceScore: this.coherenceScore,
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

  /**
   * Build the trajectory for the flow indicator (current + lookahead).
   */
  getTrajectory(): TrajectoryPoint[] {
    const trajectory: TrajectoryPoint[] = [];
    const current = this.queue.getCurrent();
    if (current) {
      trajectory.push({
        name: current.name,
        energy: current.energy ?? 0.5,
        valence: current.valence ?? 0.5,
        adopted: current.adopted ?? false,
      });
    }
    for (let i = 0; i < this.queue.getLookaheadSize(); i++) {
      const t = this.queue.peekAt(i);
      if (t) {
        trajectory.push({
          name: t.name,
          energy: t.energy ?? 0.5,
          valence: t.valence ?? 0.5,
          adopted: t.adopted ?? false,
        });
      }
    }
    return trajectory;
  }

  isRunning(): boolean {
    return this.status === 'running';
  }

  /**
   * Inject tracks into the playback queue from a user request.
   * Does NOT interrupt the currently playing track.
   *
   * During observing mode (adopted tracks playing), injected tracks are
   * queued to play AFTER all adopted tracks to avoid disrupting the
   * smooth handoff. In autonomous mode, the first track becomes "next".
   */
  async injectTracks(tracks: PlaybackTrack[]): Promise<{ injected: number }> {
    if (this.status !== 'running' || tracks.length === 0) {
      return { injected: 0 };
    }

    // During observing mode, don't displace adopted tracks — buffer all
    // injected tracks to play after the adopted queue drains
    if (this.transitionMode === 'observing') {
      for (const track of tracks) {
        this.injectedQueue.push(track);
      }
      logger.info(
        { count: tracks.length, firstTrack: tracks[0].name },
        'Buffered injected tracks for after transition (observing mode)',
      );
      this.emitState();
      return { injected: tracks.length };
    }

    const first = tracks[0];
    try {
      await addToQueue(first.uri, this.deviceId ?? undefined);
      this.queue.setNext(first);
      this.nextSyncedToSpotify = true;
      logger.info({ track: first.name, artist: first.artist }, 'Injected track as next');
    } catch (err) {
      // API failed -- still set the track in queue but mark as unsynced
      // so fillQueue will retry the Spotify sync on next poll
      logger.warn({ err, track: first.name }, 'Failed to add injected track to Spotify queue');
      this.queue.setNext(first);
      this.nextSyncedToSpotify = false;
    }

    // Remaining injected tracks go into the lookahead and injected queue
    for (let i = 1; i < tracks.length; i++) {
      this.injectedQueue.push(tracks[i]);
    }
    // bufferSyncedToSpotify needs reset since lookahead shifted
    this.bufferSyncedToSpotify = false;

    const currentAfterInject = this.queue.getCurrent();
    if (currentAfterInject) {
      this.emit('track_changed', {
        current: currentAfterInject,
        next: this.queue.peekNext(),
      });
    }
    this.emitState();

    return { injected: tracks.length };
  }

  // --- Internal ---

  /**
   * Graceful startup: respect whatever is currently playing on Spotify.
   * 1. If nothing is playing → fall back to selectAndPlayInitial()
   * 2. If something is playing → analyze the queue for coherence
   *    - Coherent queue: adopt those tracks, seed state from them
   *    - Incoherent queue: use only current track, drain later
   * Never interrupts the current song.
   */
  private async gracefulStartup(): Promise<void> {
    const sessionId = this.session.getSessionId()!;

    // 1. Check what Spotify is currently playing
    let playerState;
    try {
      playerState = await getPlayerState();
    } catch {
      logger.warn('Could not get player state for graceful startup -- falling back to direct start');
      await this.selectAndPlayInitial();
      return;
    }

    if (!playerState || !playerState.track || !playerState.isPlaying) {
      // Nothing playing — standard startup (select + play)
      logger.info('Nothing currently playing -- using standard startup');
      await this.selectAndPlayInitial();
      return;
    }

    // 2. Look up the current track in our library
    const currentTrackRow = getTrackBySpotifyId(playerState.track.id);

    if (!currentTrackRow) {
      // Current track isn't in library — observe it, take over when it ends
      // Init state vector with time-based defaults (no seed track available)
      stateVectorManager.initSession(sessionId);
      this.transitionMode = 'observing';
      this.adoptedTrackCount = 0;
      this.coherenceScore = null;
      this.currentTrackSpotifyId = playerState.track.id;
      this.trackStartTime = Date.now() - playerState.progressMs;
      this.lastProgressMs = playerState.progressMs;
      this.trackCount = 0; // Don't count unknown tracks
      logger.info(
        { spotifyId: playerState.track.id, trackName: playerState.track.name },
        'Current track not in library -- observing until it ends',
      );
      this.emitState();
      return;
    }

    // 3. Get Spotify's queue and resolve tracks from our DB.
    // We resolve in order and STOP at the first gap (unresolved or missing track)
    // so our adopted tracks match Spotify's actual playback order.
    // A lookup map avoids re-querying the DB in the adoption loop.
    const resolvedQueue: import('../database/types.js').TrackRow[] = [];
    const resolvedBySpotifyId = new Map<string, import('../database/types.js').TrackRow>();
    let spotifyQueueSlice: any[] = [];
    try {
      const { queue: spotifyQueue } = await getQueue();
      spotifyQueueSlice = spotifyQueue.slice(0, QUEUE_ANALYSIS_DEPTH);
      for (const item of spotifyQueueSlice) {
        if (!item?.id) break; // Unknown item — stop (gap in queue)
        const row = getTrackBySpotifyId(item.id);
        if (!row) break; // Not in our library — stop (gap)
        resolvedQueue.push(row);
        resolvedBySpotifyId.set(item.id, row);
      }
    } catch (err) {
      logger.warn({ err }, 'Could not fetch Spotify queue -- proceeding with current track only');
    }

    // 4. Analyze coherence (on contiguous resolved tracks only)
    const coherence = analyzeQueueCoherence(currentTrackRow, resolvedQueue);
    this.coherenceScore = coherence.score;

    // 5. Determine the contiguous run of adoptable tracks from the FRONT
    // of Spotify's queue. Stop at the first incoherent track so our
    // lookahead order matches Spotify's actual playback order.
    // Uses the pre-resolved lookup map to avoid duplicate DB queries.
    const contiguousAdoptable: import('../database/types.js').TrackRow[] = [];
    if (coherence.score >= QUEUE_COHERENCE_THRESHOLD) {
      const coherentIds = new Set(coherence.coherentTracks.map(t => t.id));
      for (const item of spotifyQueueSlice) {
        if (!item?.id) break;
        const row = resolvedBySpotifyId.get(item.id);
        if (!row) break; // Not resolved (gap), stop
        if (!coherentIds.has(row.id)) break; // Incoherent, stop
        contiguousAdoptable.push(row);
      }
    }

    // 6. Set current track in our internal queue (without touching Spotify)
    const currentPlayback = toPlaybackTrack(currentTrackRow);
    this.queue.setCurrent(currentPlayback);
    this.currentTrackSpotifyId = currentTrackRow.spotify_id;
    this.trackStartTime = Date.now() - playerState.progressMs;
    this.lastProgressMs = playerState.progressMs;
    this.trackCount = 1;

    // 7. Seed state and decide on queue handling
    if (contiguousAdoptable.length > 0) {
      // COHERENT: adopt contiguous coherent queue tracks
      const seedTracks = [currentTrackRow, ...contiguousAdoptable];
      stateVectorManager.seedFromTracks(sessionId, seedTracks);

      for (const track of contiguousAdoptable) {
        const pt = toPlaybackTrack(track);
        pt.adopted = true;
        this.queue.pushLookahead(pt);
      }

      this.adoptedTrackCount = contiguousAdoptable.length;
      this.transitionMode = 'observing';

      // These tracks are already in Spotify's queue in order
      this.nextSyncedToSpotify = true;
      if (contiguousAdoptable.length > 1) {
        this.bufferSyncedToSpotify = true;
      }

      logger.info(
        {
          coherenceScore: coherence.score.toFixed(3),
          adopted: this.adoptedTrackCount,
          totalCoherent: coherence.coherentTracks.length,
          tracks: contiguousAdoptable.map(t => t.name),
        },
        'Coherent queue detected -- adopting contiguous tracks for smooth handoff',
      );
    } else {
      // INCOHERENT (or empty queue): seed from current track only
      stateVectorManager.seedFromTracks(sessionId, [currentTrackRow]);
      this.adoptedTrackCount = 0;
      this.transitionMode = 'observing';

      // Don't drain now — wait for current track to end
      logger.info(
        { coherenceScore: coherence.score.toFixed(3) },
        'Incoherent or empty queue -- will take full control after current track',
      );
    }

    // 8. Record the current track play (use 0 duration — actual listen time
    //    will be calculated when the track ends in handleTrackChange)
    this.session.recordTrack(0);
    recordPlay(currentTrackRow.id);
    recordInteraction({
      trackId: currentTrackRow.id,
      sessionId,
      interactionType: 'play',
    });
    selector.onTrackPlayed(sessionId, currentTrackRow);

    // 9. Emit initial state
    this.emit('track_changed', {
      current: currentPlayback,
      next: this.queue.peekNext(),
    });
    this.emitState();
  }

  private async selectAndPlayInitial(): Promise<void> {
    // State vector wasn't seeded by gracefulStartup — init with time-based defaults
    const sessionId = this.session.getSessionId()!;
    stateVectorManager.initSession(sessionId);

    const track = this.selectNextTrack();
    if (!track) {
      logger.error('No tracks available in library. Cannot start playback.');
      this.stop();
      return;
    }

    // Clear any existing Spotify queue so Orpheus starts fresh
    await drainQueue();

    this.queue.setCurrent(track);
    this.currentTrackSpotifyId = track.spotifyId;
    this.trackStartTime = Date.now();
    this.trackCount = 1;

    try {
      await playTrack(track.uri, this.deviceId ?? undefined);
      // Fresh start -- ensure sync flags are reset before fillQueue
      this.nextSyncedToSpotify = false;
      this.bufferSyncedToSpotify = false;
    } catch (err) {
      logger.error({ err, track: track.name }, 'Failed to start playback');
      this.stop();
      return;
    }

    // Record play
    recordPlay(track.id);
    recordInteraction({
      trackId: track.id,
      sessionId,
      interactionType: 'play',
    });

    // Notify intelligence of first track
    const trackRow = getTrackBySpotifyId(track.spotifyId);
    if (trackRow) {
      selector.onTrackPlayed(sessionId, trackRow);
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
    // Dynamically size lookahead based on AI analysis interval.
    // Target = aiAnalysisInterval + 1 so the engine has a full cycle
    // of pre-selected tracks plus one extra for continuity.
    const { aiAnalysisInterval } = getAiSettings();
    this.queue.setTargetSize(aiAnalysisInterval + 1);

    // Build exclusion set from all tracks already in the queue
    const excludeIds = this.queue.getAllIds();

    // Fill lookahead slots until target size is reached
    while (this.queue.needsFill()) {
      const track = this.injectedQueue.length > 0
        ? this.injectedQueue.shift()!
        : this.selectNextTrack(excludeIds);
      if (!track) break; // No more tracks available
      this.queue.pushLookahead(track);
      excludeIds.add(track.id);
    }

    // Sync the first two lookahead positions to Spotify's queue.
    // Only these are committed -- deeper positions remain internal
    // pre-selections that the AI can re-evaluate.
    const next = this.queue.peekNext();
    if (next && !this.nextSyncedToSpotify) {
      try {
        await addToQueue(next.uri, this.deviceId ?? undefined);
        this.nextSyncedToSpotify = true;
        logger.info({ track: next.name, artist: next.artist }, 'Synced next track to Spotify queue');
      } catch (err) {
        logger.warn({ err, track: next.name }, 'Failed to sync next track to Spotify queue');
      }
    }

    const buffer = this.queue.peekBuffer();
    if (buffer && !this.bufferSyncedToSpotify) {
      try {
        await addToQueue(buffer.uri, this.deviceId ?? undefined);
        this.bufferSyncedToSpotify = true;
        logger.info({ track: buffer.name, artist: buffer.artist }, 'Synced buffer track to Spotify queue');
      } catch (err) {
        logger.warn({ err, track: buffer.name }, 'Failed to sync buffer track to Spotify queue');
      }
    }
  }

  /**
   * Select the next track to play using the intelligence engine.
   * Always falls back to random selection so the queue never starves.
   */
  private selectNextTrack(excludeIds?: Set<number>): PlaybackTrack | null {
    const sessionId = this.session.getSessionId();
    if (sessionId) {
      const selected = selector.selectNextTrack(sessionId, excludeIds);
      if (selected) return toPlaybackTrack(selected);
      logger.warn('Intelligence selector returned no candidates -- falling back to random');
    }
    // Fallback: random track from the library
    const rows = getRandomTracks(1, excludeIds);
    return rows.length > 0 ? toPlaybackTrack(rows[0]) : null;
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
    if (this.skipInProgress) {
      logger.info('pollAndProcess: skipped (skipInProgress=true)');
      return;
    }

    const playerState = await getPlayerState();

    // No active player -- tolerate transient absence before stopping
    if (!playerState || !playerState.device) {
      this.noDeviceCount++;
      if (this.noDeviceCount >= PlaybackEngine.NO_DEVICE_TOLERANCE) {
        logger.info(
          { consecutiveMisses: this.noDeviceCount },
          'No active player after multiple polls, stopping engine',
        );
        this.stop();
      } else {
        logger.debug(
          { consecutiveMisses: this.noDeviceCount, tolerance: PlaybackEngine.NO_DEVICE_TOLERANCE },
          'No active player -- waiting for device to reappear',
        );
      }
      return;
    }
    // Device is active — reset failure counter
    this.noDeviceCount = 0;

    const progressMs = playerState.progressMs;

    // Detect track change (user skipped externally or track ended naturally)
    if (playerState.track && playerState.track.id !== this.currentTrackSpotifyId) {
      await this.handleTrackChange(playerState.track.id, progressMs);
    } else if (
      playerState.track &&
      playerState.track.id === this.currentTrackSpotifyId &&
      this.lastProgressMs > 10000 &&
      progressMs < this.lastProgressMs - 10000
    ) {
      // Same track restarted (progress jumped backwards significantly).
      // This happens when Spotify replays a track because nothing was in its queue.
      // If we have a next track ready, force-play it instead of letting the replay continue.
      const next = this.queue.peekNext();
      if (next) {
        logger.info(
          { replayedTrack: playerState.track.name, forcingNext: next.name },
          'Same-track restart detected -- force-playing next queued track',
        );
        // Record completion of the replayed track
        const current = this.queue.getCurrent();
        if (current) {
          const listenDuration = this.trackStartTime ? Date.now() - this.trackStartTime : 0;
          recordInteraction({
            trackId: current.id,
            sessionId: this.session.getSessionId() ?? undefined,
            interactionType: 'play',
            listenDurationMs: listenDuration,
            completionRatio: current.durationMs > 0 ? Math.min(1, listenDuration / current.durationMs) : 0,
          });
          this.session.recordTrack(listenDuration);
        }
        // Force-play the next track directly (don't go through handleTrackChange
        // which would assume a natural transition without actually playing on Spotify)
        this.queue.advance();
        await drainQueue();
        await playTrack(next.uri, this.deviceId ?? undefined);
        this.nextSyncedToSpotify = false;
        this.bufferSyncedToSpotify = false;
        this.currentTrackSpotifyId = next.spotifyId;
        this.trackStartTime = Date.now();
        this.trackCount++;

        recordPlay(next.id);
        recordInteraction({
          trackId: next.id,
          sessionId: this.session.getSessionId() ?? undefined,
          interactionType: 'play',
        });

        const sessionId = this.session.getSessionId();
        if (sessionId) {
          const trackRow = getTrackBySpotifyId(next.spotifyId);
          if (trackRow) selector.onTrackPlayed(sessionId, trackRow);
        }

        this.emit('track_changed', { current: next, next: this.queue.peekNext() });
        this.emitState();
        await this.checkTransition();
        await this.fillQueue();
      } else {
        // No next track -- select one, then force-play it
        logger.info('Same-track restart detected but no next track -- selecting new track');
        const currentForExclude = this.queue.getCurrent();
        const restartExcludeIds = new Set<number>();
        if (currentForExclude) restartExcludeIds.add(currentForExclude.id);
        const newTrack = this.selectNextTrack(restartExcludeIds);
        if (newTrack) {
          const current = this.queue.getCurrent();
          if (current) {
            const listenDuration = this.trackStartTime ? Date.now() - this.trackStartTime : 0;
            recordInteraction({
              trackId: current.id,
              sessionId: this.session.getSessionId() ?? undefined,
              interactionType: 'play',
              listenDurationMs: listenDuration,
              completionRatio: current.durationMs > 0 ? Math.min(1, listenDuration / current.durationMs) : 0,
            });
            this.session.recordTrack(listenDuration);
          }
          this.queue.setNext(newTrack);
          this.queue.advance();
          await drainQueue();
          await playTrack(newTrack.uri, this.deviceId ?? undefined);
          this.nextSyncedToSpotify = false;
          this.bufferSyncedToSpotify = false;
          this.currentTrackSpotifyId = newTrack.spotifyId;
          this.trackStartTime = Date.now();
          this.trackCount++;

          recordPlay(newTrack.id);
          recordInteraction({
            trackId: newTrack.id,
            sessionId: this.session.getSessionId() ?? undefined,
            interactionType: 'play',
          });

          const sessionId = this.session.getSessionId();
          if (sessionId) {
            const trackRow = getTrackBySpotifyId(newTrack.spotifyId);
            if (trackRow) selector.onTrackPlayed(sessionId, trackRow);
          }

          this.emit('track_changed', { current: newTrack, next: this.queue.peekNext() });
          this.emitState();
          await this.checkTransition();
          await this.fillQueue();
        }
      }
    }

    this.lastProgressMs = progressMs;

    // Always keep the queue topped up -- ensures next + buffer are filled
    // so the AI always has at least 2 tracks ready for recalibration.
    await this.fillQueue();
  }

  private async handleTrackChange(
    newSpotifyId: string,
    progressMs: number,
  ): Promise<void> {
    logger.info(
      { newSpotifyId, currentTrackSpotifyId: this.currentTrackSpotifyId },
      'handleTrackChange() called',
    );
    this.logQueueState('handleTrackChange-entry');
    const previous = this.queue.getCurrent();
    let completionRatio = 0;

    if (previous) {
      const listenDuration = this.trackStartTime ? Date.now() - this.trackStartTime : 0;
      completionRatio = previous.durationMs > 0
        ? Math.min(1, listenDuration / previous.durationMs)
        : 0;

      // Record completion (natural end or external skip)
      const wasSkipped = completionRatio < 0.95;
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
      // Natural transition to our queued track -- perfect
      logger.info({ track: expectedNext.name }, 'Natural transition to queued track');
      this.queue.advance();
      // Buffer was promoted to next -- carry its sync state
      this.nextSyncedToSpotify = this.bufferSyncedToSpotify;
      this.bufferSyncedToSpotify = false;
    } else if (expectedNext && completionRatio >= 0.95) {
      // Track ended naturally but Spotify played its autoplay instead of our queue.
      // Force-play the intended track to maintain Orpheus control.
      logger.info(
        { intended: expectedNext.name, spotifyPlayed: newSpotifyId },
        'Queue mismatch on natural transition -- force-playing intended track',
      );
      this.queue.advance();
      try {
        // Drain stale queue entries before force-playing to prevent duplicates
        await drainQueue();
        await playTrack(expectedNext.uri, this.deviceId ?? undefined);
        // Reset sync flags -- queue was drained and playTrack started fresh
        this.nextSyncedToSpotify = false;
        this.bufferSyncedToSpotify = false;
        this.currentTrackSpotifyId = expectedNext.spotifyId;
        this.trackStartTime = Date.now();
        this.trackCount++;

        const forced = this.queue.getCurrent();
        if (forced) recordPlay(forced.id);

        const sessionId = this.session.getSessionId();
        if (sessionId) {
          const trackRow = getTrackBySpotifyId(expectedNext.spotifyId);
          if (trackRow) selector.onTrackPlayed(sessionId, trackRow);
        }

        // Check transition before filling (same order as normal path)
        await this.checkTransition();
        await this.fillQueue();
        this.emit('track_changed', { current: expectedNext, next: this.queue.peekNext() });
        this.emitState();
        return; // Done -- skip normal post-change handling
      } catch (err) {
        logger.warn({ err }, 'Failed to force-play intended track, accepting Spotify autoplay');
        // Fall through to accept whatever Spotify is playing
      }
    } else {
      // User manually changed the track on Spotify -- accept it
      logger.info(
        { newSpotifyId, expectedNext: expectedNext?.name ?? null, completionRatio: completionRatio.toFixed(2) },
        'External track change detected',
      );
      const externalRow = getTrackBySpotifyId(newSpotifyId);
      if (externalRow) {
        this.queue.setCurrent(toPlaybackTrack(externalRow));
      } else {
        // Track not in our DB -- clear current so we don't show stale info
        logger.info({ newSpotifyId }, 'Track not in DB -- clearing queue');
        this.queue.clear();
      }

      // External change during observing mode: skip remaining adopted tracks
      // and go straight to autonomous
      if (this.transitionMode === 'observing') {
        this.transitionMode = 'autonomous';
        this.nextSyncedToSpotify = false;
        this.bufferSyncedToSpotify = false;
        logger.info('External track change during observing -- jumping to autonomous mode');

        // Drain incoherent queue items so Orpheus takes full control
        if (this.coherenceScore !== null && this.coherenceScore < QUEUE_COHERENCE_THRESHOLD) {
          try {
            await drainQueue();
            logger.info('Drained incoherent Spotify queue during transition');
          } catch (err) {
            logger.warn({ err }, 'Failed to drain incoherent queue during transition');
          }
        }

        this.emit('transition_complete', {
          adoptedTracks: this.adoptedTrackCount,
          coherenceScore: this.coherenceScore,
        });
      }
    }

    this.currentTrackSpotifyId = newSpotifyId;
    this.trackStartTime = Date.now();

    const current = this.queue.getCurrent();
    // Only count the track if we know what it is
    if (current) {
      this.trackCount++;
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

    // --- Transition logic (before fillQueue so drain doesn't conflict) ---
    await this.checkTransition();

    // Fill queue with new tracks
    await this.fillQueue();

    if (current) {
      this.emit('track_changed', { current, next: this.queue.peekNext() });
    }

    this.logQueueState('handleTrackChange-exit');
    this.emitState();
  }

  /**
   * Check if the observing→autonomous transition should happen.
   * Called after every track change / skip to detect when all adopted tracks
   * have been consumed and Orpheus should take full control.
   *
   * Note: Queue draining for incoherent queues is handled in the external-change
   * handler inside handleTrackChange(), not here, to avoid conflicting with
   * fillQueue() calls.
   */
  private async checkTransition(): Promise<void> {
    if (this.transitionMode !== 'observing') return;

    // Count remaining adopted tracks in the queue
    let remainingAdopted = 0;
    for (let i = 0; i < this.queue.getLookaheadSize(); i++) {
      const t = this.queue.peekAt(i);
      if (t?.adopted) remainingAdopted++;
    }

    if (remainingAdopted > 0) return;

    // All adopted tracks consumed — take full control
    this.transitionMode = 'autonomous';
    logger.info(
      { adoptedTracks: this.adoptedTrackCount, coherenceScore: this.coherenceScore?.toFixed(3) },
      'Transition complete -- Orpheus now in full autonomous control',
    );

    this.emit('transition_complete', {
      adoptedTracks: this.adoptedTrackCount,
      coherenceScore: this.coherenceScore,
    });
  }

  private emitState(): void {
    const current = this.queue.getCurrent();
    this.emit('state_updated', {
      state: this.getState(),
      current,
      next: this.queue.peekNext(),
      trajectory: this.getTrajectory(),
    });
  }
}

// Singleton engine instance
export const engine = new PlaybackEngine();
