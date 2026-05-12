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
  options?: { timeout?: number; system?: string },
): Promise<string | null> {
  const timeout = options?.timeout ?? AI_REQUEST_TIMEOUT_MS;
  const start = Date.now();

  try {
    logger.debug({ model: config.ai.ollamaModel, promptLength: prompt.length, hasSystem: !!options?.system }, 'Ollama generate request');

    const response = await fetch(`${config.ai.ollamaHost}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ai.ollamaModel,
        prompt,
        stream: false,
        ...(options?.system ? { system: options.system } : {}),
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
  options?: { timeout?: number; system?: string },
): Promise<T | null> {
  const timeout = options?.timeout ?? AI_REQUEST_TIMEOUT_MS;
  const start = Date.now();

  try {
    logger.debug({ model: config.ai.ollamaModel, promptLength: prompt.length, hasSystem: !!options?.system }, 'Ollama generateJson request');

    const response = await fetch(`${config.ai.ollamaHost}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ai.ollamaModel,
        prompt,
        stream: false,
        format: 'json',
        ...(options?.system ? { system: options.system } : {}),
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

    const parsed = JSON.parse(data.response);

    // Basic shape validation: AI should return an object, not a primitive or array
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      logger.warn({ type: typeof parsed, isArray: Array.isArray(parsed) }, 'Ollama returned non-object JSON');
      return null;
    }

    return parsed as T;
  } catch (err) {
    const elapsed = Date.now() - start;
    logger.warn({ err, elapsed }, 'Ollama generateJson failed');
    return null;
  }
}

/**
 * Schema-constrained chat completion via Ollama /api/chat.
 * Passes a full JSON Schema object to the `format` parameter (Ollama 0.5+),
 * which constrains the model's output to the exact shape defined by the schema.
 * Use this for structured outputs where a loose `format: 'json'` is insufficient.
 *
 * @param messages Array of {role, content} chat messages
 * @param schema   JSON Schema object constraining the response shape
 * @param options  timeout (ms), temperature override
 */
export async function generateChat<T>(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  schema: Record<string, unknown>,
  options?: { timeout?: number; temperature?: number },
): Promise<T | null> {
  const timeout = options?.timeout ?? AI_REQUEST_TIMEOUT_MS;
  const start = Date.now();

  try {
    logger.debug(
      { model: config.ai.ollamaModel, messageCount: messages.length },
      'Ollama generateChat request',
    );

    const response = await fetch(`${config.ai.ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ai.ollamaModel,
        messages,
        format: schema,
        stream: false,
        options: { temperature: options?.temperature ?? 0.7 },
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Ollama generateChat returned non-OK status');
      return null;
    }

    const data = (await response.json()) as { message?: { content?: string } };
    const elapsed = Date.now() - start;
    const content = data.message?.content;

    if (!content) {
      logger.warn({ elapsed }, 'Ollama generateChat returned empty content');
      return null;
    }

    logger.info({ elapsed, contentLength: content.length }, 'Ollama generateChat complete');
    logger.debug({ content }, 'Ollama generateChat raw response');

    const parsed = JSON.parse(content);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      logger.warn({ type: typeof parsed }, 'Ollama generateChat returned non-object JSON');
      return null;
    }

    return parsed as T;
  } catch (err) {
    const elapsed = Date.now() - start;
    logger.warn({ err, elapsed }, 'Ollama generateChat failed');
    return null;
  }
}
