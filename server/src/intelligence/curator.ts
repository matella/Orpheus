import { EventEmitter } from 'node:events';
import { generateChat } from '../ai/ollama.js';
import { isAiEnabled } from '../ai/service.js';
import {
  buildCuratorUserMessage,
  CURATION_RESULT_SCHEMA,
  type CurationResult,
  type CandidateTrack,
} from '../ai/prompts.js';
import {
  buildPersonaSystemPrompt,
  describeSteeringForPrompt,
} from '../ai/personas.js';
import { assembleListenerContext } from './listener-context.js';
import { buildCuratorPool } from './pool-builder.js';
import { stateVectorManager } from './state-vector.js';
import type { PlaybackTrack } from '../playback/types.js';
import { getDb } from '../database/connection.js';
import { getTrackAudioFeatures } from '../spotify/recommendations.js';
import {
  getTrackBySpotifyId,
  upsertTrack,
  updateAudioFeatures,
} from '../database/repositories/track.repo.js';
import { logger } from '../shared/logger.js';

const CURATOR_TIMEOUT_MS = 15_000;
const FALLBACK_RETRY_INTERVAL_MS = 2 * 60 * 1000;
const SPAM_SKIP_THRESHOLD = 3;
const SPAM_SKIP_WINDOW_MS = 10_000;
const STEERING_DEBOUNCE_MS = 5_000;

export interface CuratorPick {
  track: PlaybackTrack;
  reason: string;
}

export interface CuratorUpdate {
  picks: CuratorPick[];
  patter: string;
  source: 'llm' | 'fallback';
}

export interface CuratorEvents {
  curator_update: CuratorUpdate;
  curator_fallback: { reason: 'timeout' | 'unavailable' | 'error' };
  curator_restored: Record<string, never>;
}

function trackRowToPlayback(row: { id: number; spotify_id: string; name: string; artist: string; album: string | null; album_art_url: string | null; duration_ms: number; energy: number | null; valence: number | null; tempo: number | null; danceability: number | null; acousticness: number | null; instrumentalness: number | null; loudness: number | null; speechiness: number | null; genre_cluster: string | null; aggressiveness: number | null; familiarity_score: number }, source: 'library' | 'similar' | 'discovery'): PlaybackTrack {
  return {
    id: row.id,
    spotifyId: row.spotify_id,
    uri: `spotify:track:${row.spotify_id}`,
    name: row.name,
    artist: row.artist,
    album: row.album,
    albumArtUrl: row.album_art_url,
    durationMs: row.duration_ms,
    energy: row.energy,
    valence: row.valence,
    tempo: row.tempo,
    danceability: row.danceability,
    acousticness: row.acousticness,
    instrumentalness: row.instrumentalness,
    loudness: row.loudness,
    speechiness: row.speechiness,
    genreCluster: row.genre_cluster,
    aggressiveness: row.aggressiveness,
    familiarityScore: row.familiarity_score,
    source,
    adopted: false,
  };
}

function getTrackById(id: number): PlaybackTrack | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as Parameters<typeof trackRowToPlayback>[0] | undefined;
  return row ? trackRowToPlayback(row, 'library') : null;
}

/**
 * LLM-driven DJ curator — the primary intelligence layer.
 *
 * Picks 3 tracks at a time using the configured Ollama model, validates
 * every returned track_id against the candidate pool, and emits curator
 * events consumed by the playback engine and WebSocket broadcast.
 *
 * Falls back to the algorithmic selector when the LLM is unavailable,
 * and automatically retries the LLM every 2 minutes.
 */
class DjCurator extends EventEmitter {
  private inFallback = false;
  private fallbackRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private steeringDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private skipTimestamps: number[] = [];
  private sessionId: number | null = null;
  private recentTrackIds = new Set<number>();
  private recentArtists = new Set<string>();
  private running = false;

  initSession(sessionId: number): void {
    this.sessionId = sessionId;
    this.recentTrackIds = new Set();
    this.recentArtists = new Set();
    this.skipTimestamps = [];
    this.inFallback = false;
    this.running = true;
    this._clearRetryTimer();
    logger.info({ sessionId }, 'DJ curator session initialized');
  }

  endSession(): void {
    this.running = false;
    this.sessionId = null;
    this._clearRetryTimer();
    this._clearSteeringDebounce();
    logger.info('DJ curator session ended');
  }

  /** Call when a track starts playing — keeps recent track context fresh. */
  onTrackPlayed(track: PlaybackTrack): void {
    this.recentTrackIds.add(track.id);
    if (this.recentTrackIds.size > 20) {
      const [first] = this.recentTrackIds;
      this.recentTrackIds.delete(first);
    }
    this.recentArtists.add(track.artist);
    if (this.recentArtists.size > 10) {
      const [first] = this.recentArtists;
      this.recentArtists.delete(first);
    }
  }

  /** Debounced trigger after steering slider changes. */
  onSteeringChanged(): void {
    this._clearSteeringDebounce();
    this.steeringDebounceTimer = setTimeout(() => {
      this.curate('steering').catch((err) =>
        logger.debug({ err }, 'Curator steering trigger failed'),
      );
    }, STEERING_DEBOUNCE_MS);
  }

  /** Record a skip and trigger curator if rapid-skip threshold is hit. */
  onSkip(): void {
    const now = Date.now();
    this.skipTimestamps = this.skipTimestamps.filter((t) => now - t < SPAM_SKIP_WINDOW_MS);
    this.skipTimestamps.push(now);

    if (this.skipTimestamps.length >= SPAM_SKIP_THRESHOLD) {
      logger.info('Rapid-skip detected — throttling curator, staying in fallback mode');
      // Throttle: don't fire curator while spam-skipping; engine uses algorithmic fallback.
      return;
    }
  }

  /**
   * Main curation entry point. Assembles context, builds pool, calls LLM,
   * validates picks, and emits curator_update.
   *
   * @param trigger What caused this curation call (for logging).
   * @param currentTrack The track currently playing (for context + exclusion).
   * @param fallbackFn Sync function that returns 1 bridge track for rapid-skip recovery.
   */
  async curate(
    trigger: 'proactive' | 'session_start' | 'request' | 'steering' | 'rapid_skip',
    currentTrack?: PlaybackTrack | null,
    fallbackFn?: () => PlaybackTrack | null,
  ): Promise<CuratorUpdate | null> {
    if (!this.running || !this.sessionId) return null;

    if (!isAiEnabled()) {
      return this._handleFallback('unavailable', fallbackFn);
    }

    const sessionId = this.sessionId;
    const ctx = assembleListenerContext(
      currentTrack ? { name: currentTrack.name, artist: currentTrack.artist } : undefined,
    );

    const pool = await buildCuratorPool(
      sessionId,
      ctx.discoveryAppetite,
      this.recentTrackIds,
      this.recentArtists,
      currentTrack ? { spotifyId: currentTrack.spotifyId } : null,
    );

    if (pool.length < 3) {
      logger.warn({ poolSize: pool.length }, 'Curator pool too small — using fallback');
      return this._handleFallback('error', fallbackFn);
    }

    const steeringDescription = describeSteeringForPrompt(ctx.steering);
    const systemPrompt = buildPersonaSystemPrompt(
      ctx.persona,
      ctx.customPersona,
      ctx.chattiness,
      steeringDescription,
    );

    const userMessage = buildCuratorUserMessage(
      {
        topArtists: ctx.topArtists,
        topGenres: ctx.topGenres,
        recentTracks: ctx.recentTracks,
        justPlayed: ctx.justPlayed,
        mood: ctx.mood,
        timePhraseDescription: ctx.timePhrase,
      },
      pool,
    );

    logger.info({ trigger, poolSize: pool.length, persona: ctx.persona }, 'Calling LLM curator');

    const raw = await generateChat<CurationResult>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      CURATION_RESULT_SCHEMA,
      { timeout: CURATOR_TIMEOUT_MS, temperature: 0.7 },
    );

    if (!raw) {
      return this._handleFallback('timeout', fallbackFn);
    }

    const picks = await this._validateAndResolvePicks(raw, pool, currentTrack ?? null, sessionId);

    // Artist dedup inside _validateAndResolvePicks can trim one pick — tolerate 2
    if (picks.length < 2) {
      logger.warn({ resolved: picks.length }, 'Not enough valid picks after validation — using fallback');
      return this._handleFallback('error', fallbackFn);
    }

    if (this.inFallback) {
      this.inFallback = false;
      this._clearRetryTimer();
      this.emit('curator_restored', {});
      logger.info('Curator restored from fallback');
    }

    const update: CuratorUpdate = {
      picks,
      patter: (raw.patter ?? '').trim(),
      source: 'llm',
    };

    this.emit('curator_update', update);
    logger.info({ trigger, patterLength: update.patter.length }, 'Curator update emitted');

    return update;
  }

  get isFallbackActive(): boolean {
    return this.inFallback;
  }

  // ── Private ─────────────────────────────────────────────────────────

  private async _validateAndResolvePicks(
    raw: CurationResult,
    pool: CandidateTrack[],
    currentTrack: PlaybackTrack | null,
    sessionId: number,
  ): Promise<CuratorPick[]> {
    const poolById = new Map(pool.map((t) => [t.trackId, t]));
    const used = new Set<string>();
    const picks: CuratorPick[] = [];

    for (const item of raw.picks ?? []) {
      const tid = item.track_id;
      if (!tid || !poolById.has(tid) || used.has(tid)) continue;

      const candidateTrack = poolById.get(tid)!;
      const isExternal = !/^\d+$/.test(tid);
      const dbRow = isExternal
        ? await this._resolveExternalTrack(tid, candidateTrack)
        : getTrackById(Number(tid));
      if (!dbRow) continue;

      dbRow.source = candidateTrack.source;
      picks.push({ track: dbRow, reason: item.reason ?? '' });
      used.add(tid);
      if (picks.length === 3) break;
    }

    // Backfill if the LLM hallucinated or deduped fewer than 3 (library tracks only)
    if (picks.length < 3) {
      const usedDbIds = new Set(picks.map((p) => p.track.id));
      for (const candidate of pool) {
        if (picks.length >= 3) break;
        if (used.has(candidate.trackId)) continue;
        if (candidate.spotifyUri) continue; // external candidates can't be backfilled
        const dbRow = getTrackById(Number(candidate.trackId));
        if (!dbRow || usedDbIds.has(dbRow.id)) continue;
        dbRow.source = candidate.source;
        picks.push({ track: dbRow, reason: '(backfill)' });
        used.add(candidate.trackId);
      }
    }

    // Transition check: reorder if energy delta > 0.8 between adjacent picks
    if (currentTrack && picks.length >= 2) {
      this._smoothTransitions(picks, currentTrack, sessionId);
    }

    // Dedup artists (no same artist twice unless LLM explicitly flagged it)
    const artistCount = new Map<string, number>();
    return picks.filter((p) => {
      const count = artistCount.get(p.track.artist) ?? 0;
      artistCount.set(p.track.artist, count + 1);
      // Allow if only 1 occurrence, or if the LLM reason mentions intentionality
      return count === 0 || p.reason.toLowerCase().includes('callback') || p.reason.toLowerCase().includes('intentional');
    });
  }

  private async _resolveExternalTrack(
    spotifyId: string,
    candidate: CandidateTrack,
  ): Promise<PlaybackTrack | null> {
    try {
      const existing = getTrackBySpotifyId(spotifyId);
      if (existing) {
        return trackRowToPlayback(existing as Parameters<typeof trackRowToPlayback>[0], candidate.source);
      }

      upsertTrack({
        spotifyId,
        name: candidate.name,
        artist: candidate.artist,
        artistId: candidate.artistId,
        album: candidate.album,
        durationMs: candidate.durationMs ?? 0,
        source: 'external',
      });

      const features = await getTrackAudioFeatures(spotifyId);
      if (
        features &&
        features.energy !== null && features.valence !== null && features.tempo !== null &&
        features.danceability !== null && features.acousticness !== null &&
        features.instrumentalness !== null && features.loudness !== null &&
        features.speechiness !== null && features.key !== null &&
        features.mode !== null && features.timeSignature !== null
      ) {
        updateAudioFeatures({
          spotifyId,
          energy: features.energy,
          valence: features.valence,
          tempo: features.tempo,
          danceability: features.danceability,
          acousticness: features.acousticness,
          instrumentalness: features.instrumentalness,
          loudness: features.loudness,
          speechiness: features.speechiness,
          key: features.key,
          mode: features.mode,
          timeSignature: features.timeSignature,
        });
      }

      const saved = getTrackBySpotifyId(spotifyId);
      if (!saved) return null;
      return trackRowToPlayback(saved as Parameters<typeof trackRowToPlayback>[0], candidate.source);
    } catch (err) {
      logger.warn({ err, spotifyId }, 'Failed to resolve external track — skipping');
      return null;
    }
  }

  private _smoothTransitions(
    picks: CuratorPick[],
    currentTrack: PlaybackTrack,
    sessionId: number,
  ): void {
    const stateVector = stateVectorManager.getState(sessionId);
    if (!stateVector) return;

    const energyOf = (t: PlaybackTrack) => t.energy ?? stateVector.energy;
    const prevEnergies = [energyOf(currentTrack), ...picks.slice(0, -1).map((p) => energyOf(p.track))];

    let reordered = false;
    for (let i = 0; i < picks.length; i++) {
      const delta = Math.abs(energyOf(picks[i].track) - prevEnergies[i]);
      if (delta > 0.8) {
        // Find a better-fit pick to swap in at this position
        for (let j = i + 1; j < picks.length; j++) {
          const swapDelta = Math.abs(energyOf(picks[j].track) - prevEnergies[i]);
          if (swapDelta <= 0.8) {
            [picks[i], picks[j]] = [picks[j], picks[i]];
            reordered = true;
            break;
          }
        }
      }
    }

    if (reordered) {
      logger.debug('Curator reordered picks to smooth energy transition');
    }
  }

  private _handleFallback(
    reason: 'timeout' | 'unavailable' | 'error',
    fallbackFn?: () => PlaybackTrack | null,
  ): null {
    if (!this.inFallback) {
      this.inFallback = true;
      this.emit('curator_fallback', { reason });
      logger.warn({ reason }, 'Curator entering fallback mode');
      this._scheduleRetry();
    }

    // If a bridge track function was provided, use it (rapid-skip recovery)
    if (fallbackFn) {
      const bridge = fallbackFn();
      if (bridge) {
        logger.debug({ track: bridge.name }, 'Curator fallback: bridge track selected');
      }
    }

    return null;
  }

  private _scheduleRetry(): void {
    this._clearRetryTimer();
    this.fallbackRetryTimer = setTimeout(async () => {
      if (!this.running || !this.inFallback) return;
      logger.info('Curator fallback: retrying LLM health check');
      const result = await this.curate('proactive').catch(() => null);
      if (!result) {
        // Still failing — schedule another retry
        this._scheduleRetry();
      }
    }, FALLBACK_RETRY_INTERVAL_MS);
  }

  private _clearRetryTimer(): void {
    if (this.fallbackRetryTimer) {
      clearTimeout(this.fallbackRetryTimer);
      this.fallbackRetryTimer = null;
    }
  }

  private _clearSteeringDebounce(): void {
    if (this.steeringDebounceTimer) {
      clearTimeout(this.steeringDebounceTimer);
      this.steeringDebounceTimer = null;
    }
  }
}

export const curator = new DjCurator();
