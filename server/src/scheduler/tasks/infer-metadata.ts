import { registerTask } from '../scheduler.js';
import { isAiEnabled, inferTrackGenres } from '../../ai/service.js';
import { insertAiSuggestion } from '../../database/repositories/ai-suggestion.repo.js';
import {
  getTracksNeedingGenreInference,
  setAiInferredGenre,
  markGenreInferenceFailed,
  getGenreInferenceBacklog,
} from '../../database/repositories/track.repo.js';
import {
  AI_GENRE_INFERENCE_BATCH_SIZE,
  AI_GENRE_INFERENCE_MAX_BATCHES,
  AI_GENRE_INFERENCE_CONFIDENCE_THRESHOLD,
} from '../../shared/constants.js';
import { logger } from '../../shared/logger.js';

const INTER_BATCH_DELAY_MS = 2000;

/**
 * Register the AI metadata inference task with the scheduler.
 * Runs every 6 hours at :30 (offset from library sync at :00)
 * to infer genres for tracks where Spotify has no genre data.
 */
export function registerMetadataInferenceTask(): void {
  registerTask({
    name: 'ai-metadata-inference',
    schedule: '30 */6 * * *',
    handler: async () => {
      await runMetadataInference();
    },
    runOnStart: false,
  });
}

async function runMetadataInference(): Promise<void> {
  if (!isAiEnabled()) {
    logger.debug('AI metadata inference skipped — AI is disabled');
    return;
  }

  const backlog = getGenreInferenceBacklog();
  if (backlog === 0) {
    logger.debug('No tracks need genre inference');
    return;
  }

  logger.info({ backlog }, 'Starting AI genre inference');
  let totalInferred = 0;
  let totalFailed = 0;

  for (let batch = 0; batch < AI_GENRE_INFERENCE_MAX_BATCHES; batch++) {
    const tracks = getTracksNeedingGenreInference(AI_GENRE_INFERENCE_BATCH_SIZE);
    if (tracks.length === 0) break;

    const input = tracks.map((t) => ({
      id: t.id,
      name: t.name,
      artist: t.artist,
      album: t.album,
    }));

    const result = await inferTrackGenres(input);

    if (!result) {
      // AI unavailable — stop this run entirely
      logger.warn('AI genre inference: Ollama unavailable, stopping run');
      break;
    }

    // Build lookup map from AI results
    const resultMap = new Map(result.tracks.map((r) => [r.id, r]));

    for (const track of tracks) {
      const inference = resultMap.get(track.id);

      if (inference?.genre && inference.confidence >= AI_GENRE_INFERENCE_CONFIDENCE_THRESHOLD) {
        setAiInferredGenre(track.id, inference.genre);
        totalInferred++;
      } else {
        markGenreInferenceFailed(track.id);
        totalFailed++;
      }
    }

    // Audit log
    insertAiSuggestion({
      sessionId: null,
      suggestionType: 'genre_inference',
      prompt: JSON.stringify(input.map((t) => `${t.name} - ${t.artist}`)),
      response: JSON.stringify(result),
      applied: true,
    });

    // Rate limit between batches
    if (batch < AI_GENRE_INFERENCE_MAX_BATCHES - 1 && tracks.length === AI_GENRE_INFERENCE_BATCH_SIZE) {
      await new Promise((resolve) => setTimeout(resolve, INTER_BATCH_DELAY_MS));
    }
  }

  logger.info(
    { totalInferred, totalFailed, remainingBacklog: getGenreInferenceBacklog() },
    'AI genre inference run complete',
  );
}
