import { getValidToken } from './auth.js';
import { SpotifyApiError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

/**
 * Make an authenticated request to the Spotify API.
 */
export async function spotifyFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getValidToken();

  const url = endpoint.startsWith('http') ? endpoint : `${SPOTIFY_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Handle rate limiting
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') ?? '5', 10);
    logger.warn({ retryAfter }, 'Spotify rate limit hit, backing off');
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return spotifyFetch<T>(endpoint, options);
  }

  // No content (e.g., successful playback commands)
  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, endpoint, body: errorBody }, 'Spotify API error');
    throw new SpotifyApiError(
      `Spotify API error: ${response.status} on ${endpoint}`,
      response.status >= 500 ? 502 : response.status,
    );
  }

  // Some endpoints (e.g. /me/player/queue) may return non-JSON or empty bodies
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
