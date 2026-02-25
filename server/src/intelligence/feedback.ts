import { updatePreference } from '../database/repositories/preference.repo.js';
import { LEARNING } from '../shared/constants.js';
import { logger } from '../shared/logger.js';

/**
 * Process a user interaction and adjust the track's preference score accordingly.
 *
 * Interaction types and their effects:
 * - play (completion > 80%): small positive delta
 * - skip (< 30s): negative delta
 * - skip (30-60s): mild negative delta
 * - like: strong positive delta
 * - dislike: strong negative delta (asymmetric — dislikes weigh more)
 */
export function processInteractionFeedback(interaction: {
  track_id: number;
  interaction_type: string;
  listen_duration_ms?: number | null;
  completion_ratio?: number | null;
}): void {
  let delta = 0;

  switch (interaction.interaction_type) {
    case 'play': {
      if (
        interaction.completion_ratio !== null &&
        interaction.completion_ratio !== undefined &&
        interaction.completion_ratio > 0.8
      ) {
        delta = LEARNING.completionPositive;
      }
      break;
    }

    case 'skip': {
      const durationMs = interaction.listen_duration_ms ?? 0;
      if (durationMs < 30000) {
        delta = LEARNING.skipNegative;
      } else if (durationMs < 60000) {
        delta = LEARNING.skipMildNegative;
      }
      break;
    }

    case 'like': {
      delta = LEARNING.likePositive;
      break;
    }

    case 'dislike': {
      delta = LEARNING.dislikeNegative;
      break;
    }
  }

  if (delta !== 0) {
    updatePreference(interaction.track_id, delta);
    logger.debug(
      { trackId: interaction.track_id, type: interaction.interaction_type, delta },
      'Preference updated from interaction',
    );
  }
}
