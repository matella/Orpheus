import { getStateHistory } from '../database/repositories/state-history.repo.js';
import { getSessionById } from '../database/repositories/session.repo.js';
import { updateTimePreferences } from '../database/repositories/time-preferences.repo.js';
import { logger } from '../shared/logger.js';
import type { TrackRow } from '../database/types.js';

/**
 * Determine the time bracket for a given hour.
 */
function getTimeBracket(hour: number): string {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/**
 * Learn time-of-day preferences from a completed session.
 *
 * Averages the session's state trajectory and updates the time_preferences
 * table for the bracket that the session started in. Only learns from
 * sessions with enough data (>= 3 state snapshots).
 */
export function learnTimePreferences(sessionId: number): void {
  try {
    const session = getSessionById(sessionId);
    if (!session) return;

    const history = getStateHistory(sessionId);
    if (history.length < 3) {
      logger.debug({ sessionId, snapshots: history.length }, 'Too few state snapshots to learn from');
      return;
    }

    // Determine time bracket from session start
    const startHour = new Date(session.started_at).getHours();
    const bracket = getTimeBracket(startHour);

    // Compute averages across the session trajectory.
    // Use per-dimension counters so null values don't deflate averages.
    let sumEnergy = 0, cntEnergy = 0;
    let sumValence = 0, cntValence = 0;
    let sumTempo = 0, cntTempo = 0;
    let sumFamiliarity = 0, cntFamiliarity = 0;
    let sumVocalness = 0, cntVocalness = 0;
    let sumAggressiveness = 0, cntAggressiveness = 0;
    const genreCounts: Record<string, number> = {};

    for (const snap of history) {
      if (snap.energy != null) { sumEnergy += snap.energy; cntEnergy++; }
      if (snap.valence != null) { sumValence += snap.valence; cntValence++; }
      if (snap.tempo != null) { sumTempo += snap.tempo; cntTempo++; }
      if (snap.familiarity != null) { sumFamiliarity += snap.familiarity; cntFamiliarity++; }
      if (snap.vocalness != null) { sumVocalness += snap.vocalness; cntVocalness++; }
      if (snap.aggressiveness != null) { sumAggressiveness += snap.aggressiveness; cntAggressiveness++; }
      if (snap.genre_cluster) {
        genreCounts[snap.genre_cluster] = (genreCounts[snap.genre_cluster] ?? 0) + 1;
      }
    }

    // Need at least one valid dimension to learn from
    if (cntEnergy === 0 && cntValence === 0 && cntTempo === 0) return;

    // Find dominant genre
    let topGenre: string | null = null;
    let maxGenreCount = 0;
    for (const [genre, cnt] of Object.entries(genreCounts)) {
      if (cnt > maxGenreCount) {
        topGenre = genre;
        maxGenreCount = cnt;
      }
    }

    updateTimePreferences(bracket, {
      energy: cntEnergy > 0 ? sumEnergy / cntEnergy : 0.5,
      valence: cntValence > 0 ? sumValence / cntValence : 0.5,
      tempo: cntTempo > 0 ? sumTempo / cntTempo : 120,
      familiarity: cntFamiliarity > 0 ? sumFamiliarity / cntFamiliarity : 0.5,
      vocalness: cntVocalness > 0 ? sumVocalness / cntVocalness : 0.5,
      aggressiveness: cntAggressiveness > 0 ? sumAggressiveness / cntAggressiveness : 0.3,
      topGenre,
    });

    logger.info(
      { sessionId, bracket, snapshots: cntEnergy, topGenre },
      'Learned time preferences from session',
    );
  } catch (err) {
    logger.warn({ err, sessionId }, 'Failed to learn time preferences');
  }
}

/**
 * Learn time-of-day preferences from a single external Spotify play.
 * Uses the track's audio features and the play timestamp to update
 * the time_preferences table, giving external plays equal influence.
 */
export function learnFromExternalPlay(track: TrackRow, playedAt: string): void {
  try {
    // Skip if track has no audio features yet
    if (track.energy === null || track.valence === null || track.tempo === null) {
      return;
    }

    const playHour = new Date(playedAt).getHours();
    const bracket = getTimeBracket(playHour);

    const vocalness = 1 - (track.instrumentalness ?? 0.5);

    updateTimePreferences(bracket, {
      energy: track.energy,
      valence: track.valence,
      tempo: track.tempo,
      familiarity: track.familiarity_score,
      vocalness,
      aggressiveness: track.aggressiveness ?? 0.3,
      topGenre: track.genre_cluster,
    });
  } catch (err) {
    logger.warn({ err, trackName: track.name }, 'Failed to learn time prefs from external play');
  }
}
