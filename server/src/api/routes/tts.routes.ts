import type { FastifyInstance } from 'fastify';
import { piperAdapter } from '../../tts/piper.js';
import { getDjPreferences, updateDjPreferences } from '../../database/repositories/dj-preferences.repo.js';
import { logger } from '../../shared/logger.js';

const TTS_UNAVAILABLE = { error: 'tts_unavailable', message: 'Piper TTS is not installed or configured.' };

export async function ttsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/tts/voices
   * List available Piper voice models from PIPER_VOICES_DIR.
   */
  fastify.get('/voices', async (_request, reply) => {
    if (!piperAdapter.isAvailable()) {
      return reply.status(503).send(TTS_UNAVAILABLE);
    }
    const voices = await piperAdapter.listVoices();
    return { voices };
  });

  /**
   * GET /api/tts/speak?text=…
   * Generate and return WAV audio for the given text using the saved voice.
   */
  fastify.get<{ Querystring: { text: string } }>('/speak', async (request, reply) => {
    if (!piperAdapter.isAvailable()) {
      return reply.status(503).send(TTS_UNAVAILABLE);
    }

    const { text } = request.query;
    if (!text || text.trim().length === 0) {
      return reply.status(400).send({ error: 'text query parameter is required' });
    }

    const prefs = getDjPreferences();

    try {
      const wav = await piperAdapter.speak(text.trim(), prefs.ttsVoice);
      reply.header('Content-Type', 'audio/wav');
      reply.header('Content-Length', wav.length);
      return reply.send(wav);
    } catch (err) {
      logger.warn({ err }, 'TTS speak failed');
      return reply.status(503).send(TTS_UNAVAILABLE);
    }
  });

  /**
   * POST /api/tts/preview
   * Generate a WAV preview for a specific voice using a sample phrase.
   */
  fastify.post<{ Body: { voiceId: string } }>('/preview', async (request, reply) => {
    if (!piperAdapter.isAvailable()) {
      return reply.status(503).send(TTS_UNAVAILABLE);
    }

    const { voiceId } = request.body ?? {};
    if (!voiceId) {
      return reply.status(400).send({ error: 'voiceId is required' });
    }

    try {
      const wav = await piperAdapter.preview(voiceId);
      reply.header('Content-Type', 'audio/wav');
      reply.header('Content-Length', wav.length);
      return reply.send(wav);
    } catch (err) {
      logger.warn({ err, voiceId }, 'TTS preview failed');
      return reply.status(503).send(TTS_UNAVAILABLE);
    }
  });

  /**
   * PUT /api/tts/settings
   * Persist TTS preferences: enabled, voice, duck volume.
   */
  fastify.put<{ Body: { ttsEnabled?: boolean; ttsVoice?: string | null; ttsDuckVolume?: number } }>(
    '/settings',
    async (request, reply) => {
      const { ttsEnabled, ttsVoice, ttsDuckVolume } = request.body ?? {};

      // Validate duck volume range
      if (ttsDuckVolume !== undefined && (ttsDuckVolume < 0 || ttsDuckVolume > 1)) {
        return reply.status(400).send({ error: 'ttsDuckVolume must be between 0 and 1' });
      }

      const updated = updateDjPreferences({
        ...(ttsEnabled !== undefined && { ttsEnabled }),
        ...(ttsVoice !== undefined && { ttsVoice }),
        ...(ttsDuckVolume !== undefined && { ttsDuckVolume }),
      });
      return reply.send({
        ttsEnabled: updated.ttsEnabled,
        ttsVoice: updated.ttsVoice,
        ttsDuckVolume: updated.ttsDuckVolume,
      });
    },
  );
}
