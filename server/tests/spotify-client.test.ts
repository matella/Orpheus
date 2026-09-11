import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/spotify/auth.js', () => ({
  getValidToken: vi.fn().mockResolvedValue('tok'),
}));

import { spotifyFetch } from '../src/spotify/client.js';
import { SpotifyApiError } from '../src/shared/errors.js';

describe('spotifyFetch rate limiting', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects immediately when Retry-After exceeds maxRetryAfterSec, without retrying', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { 'Retry-After': '3600' } }),
    );

    const err = await spotifyFetch('/artists/abc', {}, { maxRetryAfterSec: 30 }).catch((e) => e);

    expect(err).toBeInstanceOf(SpotifyApiError);
    expect(err.statusCode).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves default retry behavior when no opts are passed', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { 'Retry-After': '0' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const result = await spotifyFetch('/artists/abc');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
