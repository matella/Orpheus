import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/spotify/client.js', () => ({ spotifyFetch: vi.fn() }));

import { spotifyFetch } from '../src/spotify/client.js';
import { createSpotifyPlaylist, addTracksToPlaylist } from '../src/spotify/player.js';
import { PlaylistPartialError, SpotifyApiError } from '../src/shared/errors.js';

const fetchMock = vi.mocked(spotifyFetch);

describe('createSpotifyPlaylist', () => {
  beforeEach(() => fetchMock.mockReset());

  it('posts to /me/playlists without a /me lookup', async () => {
    fetchMock.mockResolvedValueOnce({ id: 'pl1', external_urls: { spotify: 'https://open.spotify.com/playlist/pl1' } });

    const result = await createSpotifyPlaylist('K-pop', 'desc', true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/me/playlists', {
      method: 'POST',
      body: JSON.stringify({ name: 'K-pop', description: 'desc', public: true }),
    });
    expect(result).toEqual({ id: 'pl1', url: 'https://open.spotify.com/playlist/pl1' });
  });
});

describe('addTracksToPlaylist', () => {
  beforeEach(() => fetchMock.mockReset());

  it('posts to /items in batches of 100 and returns the count', async () => {
    fetchMock.mockResolvedValue({ snapshot_id: 's' });
    const uris = Array.from({ length: 250 }, (_, i) => `spotify:track:${i}`);

    const added = await addTracksToPlaylist('pl1', uris);

    expect(added).toBe(250);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/playlists/pl1/items', '/playlists/pl1/items', '/playlists/pl1/items',
    ]);
    const lastBody = JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string);
    expect(lastBody.uris).toHaveLength(50);
  });

  it('throws PlaylistPartialError with the added count when a batch fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ snapshot_id: 's' })
      .mockRejectedValueOnce(new SpotifyApiError('boom', 502));
    const uris = Array.from({ length: 150 }, (_, i) => `spotify:track:${i}`);

    const err = await addTracksToPlaylist('pl1', uris).catch((e) => e);

    expect(err).toBeInstanceOf(PlaylistPartialError);
    expect(err.addedCount).toBe(100);
  });

  it('rethrows the original error when the first batch fails (0 tracks added)', async () => {
    fetchMock.mockRejectedValueOnce(new SpotifyApiError('unauthorized', 401));
    const uris = Array.from({ length: 50 }, (_, i) => `spotify:track:${i}`);

    const err = await addTracksToPlaylist('pl1', uris).catch((e) => e);

    expect(err).not.toBeInstanceOf(PlaylistPartialError);
    expect(err).toBeInstanceOf(SpotifyApiError);
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('unauthorized');
  });
});
