import { config } from '../config.js';
import { logger } from '../shared/logger.js';
import { AI_REQUEST_TIMEOUT_MS } from '../shared/constants.js';

export interface OllamaStatus {
  reachable: boolean;
  modelLoaded: boolean;
  models: string[];
}

/**
 * Check if Ollama is available and whether the configured model is loaded.
 */
export async function isOllamaAvailable(): Promise<OllamaStatus> {
  try {
    const response = await fetch(`${config.ai.ollamaHost}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { reachable: false, modelLoaded: false, models: [] };
    }

    const data = (await response.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name);
    const modelLoaded = models.some(
      (m) => m === config.ai.ollamaModel || m.startsWith(`${config.ai.ollamaModel}:`),
    );

    return { reachable: true, modelLoaded, models };
  } catch {
    return { reachable: false, modelLoaded: false, models: [] };
  }
}

/**
 * Generate a text completion from Ollama. Returns null on any failure.
 */
export async function generate(
  prompt: string,
  options?: { timeout?: number },
): Promise<string | null> {
  const timeout = options?.timeout ?? AI_REQUEST_TIMEOUT_MS;
  const start = Date.now();

  try {
    logger.debug({ model: config.ai.ollamaModel, promptLength: prompt.length }, 'Ollama generate request');

    const response = await fetch(`${config.ai.ollamaHost}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ai.ollamaModel,
        prompt,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Ollama returned non-OK status');
      return null;
    }

    const data = (await response.json()) as { response?: string };
    const elapsed = Date.now() - start;

    logger.info({ elapsed, responseLength: data.response?.length ?? 0 }, 'Ollama generate complete');
    logger.debug({ response: data.response }, 'Ollama raw response');

    return data.response ?? null;
  } catch (err) {
    const elapsed = Date.now() - start;
    logger.warn({ err, elapsed }, 'Ollama generate failed');
    return null;
  }
}

/**
 * Generate a JSON completion from Ollama and parse it.
 * Returns null on any failure (network, timeout, invalid JSON).
 */
export async function generateJson<T>(
  prompt: string,
  options?: { timeout?: number },
): Promise<T | null> {
  const timeout = options?.timeout ?? AI_REQUEST_TIMEOUT_MS;
  const start = Date.now();

  try {
    logger.debug({ model: config.ai.ollamaModel, promptLength: prompt.length }, 'Ollama generateJson request');

    const response = await fetch(`${config.ai.ollamaHost}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ai.ollamaModel,
        prompt,
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Ollama returned non-OK status');
      return null;
    }

    const data = (await response.json()) as { response?: string };
    const elapsed = Date.now() - start;

    if (!data.response) {
      logger.warn({ elapsed }, 'Ollama returned empty response');
      return null;
    }

    logger.info({ elapsed, responseLength: data.response.length }, 'Ollama generateJson complete');
    logger.debug({ response: data.response }, 'Ollama raw JSON response');

    const parsed = JSON.parse(data.response) as T;
    return parsed;
  } catch (err) {
    const elapsed = Date.now() - start;
    logger.warn({ err, elapsed }, 'Ollama generateJson failed');
    return null;
  }
}
