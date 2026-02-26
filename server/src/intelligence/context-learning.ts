import { getStateHistory } from '../database/repositories/state-history.repo.js';
import { getSessionById } from '../database/repositories/session.repo.js';
import { updateTimePreferences } from '../database/repositories/time-preferences.repo.js';
import { logger } from '../shared/logger.js';

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

    // Compute averages across the session trajectory
    let sumEnergy = 0, sumValence = 0, sumTempo = 0;
    let sumFamiliarity = 0, sumVocalness = 0, sumAggressiveness = 0;
    let count = 0;
    const genreCounts: Record<string, number> = {};

    for (const snap of history) {
      if (snap.energy != null) sumEnergy += snap.energy;
      if (snap.valence != null) sumValence += snap.valence;
      if (snap.tempo != null) sumTempo += snap.tempo;
      if (snap.familiarity != null) sumFamiliarity += snap.familiarity;
      if (snap.vocalness != null) sumVocalness += snap.vocalness;
      if (snap.aggressiveness != null) sumAggressiveness += snap.aggressiveness;
      if (snap.genre_cluster) {
        genreCounts[snap.genre_cluster] = (genreCounts[snap.genre_cluster] ?? 0) + 1;
      }
      count++;
    }

    if (count === 0) return;

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
      energy: sumEnergy / count,
      valence: sumValence / count,
      tempo: sumTempo / count,
      familiarity: sumFamiliarity / count,
      vocalness: sumVocalness / count,
      aggressiveness: sumAggressiveness / count,
      topGenre,
    });

    logger.info(
      { sessionId, bracket, snapshots: count, topGenre },
      'Learned time preferences from session',
    );
  } catch (err) {
    logger.warn({ err, sessionId }, 'Failed to learn time preferences');
  }
}
