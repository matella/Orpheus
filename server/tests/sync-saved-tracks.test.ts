import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

vi.mock('../src/spotify/client.js', () => ({ spotifyFetch: vi.fn() }));

import { spotifyFetch } from '../src/spotify/client.js';
import { createTestDb, insertTestTrack } from './helpers/db.js';
import { syncSavedTracks } from '../src/spotify/library.js';

const fetchMock = vi.mocked(spotifyFetch);
let db: DatabaseSync;

const item = (id: string, addedAt: string) => ({
  added_at: addedAt,
  track: { id, name: `Song ${id}`, duration_ms: 1000, album: { name: 'Al', images: [] }, artists: [{ id: 'a1', name: 'aespa' }] },
});

beforeEach(() => {
  fetchMock.mockReset();
  db = createTestDb();
});

describe('syncSavedTracks un-like sweep', () => {
  it('clears liked_at for tracks missing from a complete pass', async () => {
    insertTestTrack(db, { spotifyId: 'gone', likedAt: '2024-01-01' });
    fetchMock.mockResolvedValueOnce({ items: [item('keep', '2024-05-01T00:00:00Z')], total: 1, next: null });

    await syncSavedTracks();

    expect(db.prepare('SELECT spotify_id, liked_at FROM tracks ORDER BY spotify_id').all()).toEqual([
      { spotify_id: 'gone', liked_at: null },
      { spotify_id: 'keep', liked_at: '2024-05-01T00:00:00Z' },
    ]);
  });

  it('does not sweep when Spotify returns an empty page for a non-empty library', async () => {
    insertTestTrack(db, { spotifyId: 'liked', likedAt: '2024-01-01' });
    fetchMock.mockResolvedValueOnce({ items: [], total: 7000, next: null });

    await syncSavedTracks();

    expect(db.prepare("SELECT liked_at FROM tracks WHERE spotify_id = 'liked'").get()).toEqual({ liked_at: '2024-01-01' });
  });
});
