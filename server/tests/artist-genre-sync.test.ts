import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

vi.mock('../src/spotify/client.js', () => ({ spotifyFetch: vi.fn() }));

import { spotifyFetch } from '../src/spotify/client.js';
import { createTestDb, insertTestTrack } from './helpers/db.js';
import { upsertArtistNames, setTrackArtists, getGenreSyncCounts } from '../src/database/repositories/artist.repo.js';
import { runArtistGenreSync, genreSyncEvents } from '../src/spotify/artist-genre-sync.js';
import { SpotifyApiError } from '../src/shared/errors.js';

const fetchMock = vi.mocked(spotifyFetch);
const noSleep = () => Promise.resolve();
let db: DatabaseSync;

function likedTrackWithArtists(spotifyId: string, artists: { id: string; name: string }[]): number {
  const id = insertTestTrack(db, { spotifyId, likedAt: '2024-01-01', artistId: artists[0].id, artist: artists[0].name });
  upsertArtistNames(artists);
  setTrackArtists(id, artists.map((a) => a.id));
  return id;
}

beforeEach(() => {
  fetchMock.mockReset();
  db = createTestDb();
});

describe('runArtistGenreSync', () => {
  it('fetches each artist individually and stores every genre', async () => {
    likedTrackWithArtists('t1', [{ id: 'a1', name: 'aespa' }, { id: 'a2', name: 'Feat' }]);
    fetchMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/artists/a1') return { id: 'a1', name: 'aespa', genres: ['k-pop', 'k-pop girl group'] };
      if (endpoint === '/artists/a2') return { id: 'a2', name: 'Feat', genres: [] };
      throw new Error(`unexpected ${endpoint}`);
    });

    const processed = await runArtistGenreSync({ sleepFn: noSleep });

    expect(processed).toBe(2);
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(['/artists/a1', '/artists/a2']);
    expect(db.prepare('SELECT artist_id, genre FROM artist_genres ORDER BY genre').all()).toEqual([
      { artist_id: 'a1', genre: 'k-pop' },
      { artist_id: 'a1', genre: 'k-pop girl group' },
    ]);
    // Artists with no genres are still marked fetched
    expect(db.prepare('SELECT COUNT(*) AS n FROM artists WHERE genres_fetched_at IS NULL').get()).toEqual({ n: 0 });
    // Engine compatibility: genre_cluster = first genre of the primary artist
    expect(db.prepare("SELECT genre_cluster FROM tracks WHERE spotify_id = 't1'").get()).toEqual({ genre_cluster: 'k-pop' });
    expect(getGenreSyncCounts()).toEqual({ done: 2, total: 2 });
  });

  it('marks 404 artists as fetched with no genres', async () => {
    likedTrackWithArtists('t1', [{ id: 'gone', name: 'Gone' }]);
    fetchMock.mockRejectedValue(new SpotifyApiError('nf', 404));

    await runArtistGenreSync({ sleepFn: noSleep });

    expect(getGenreSyncCounts()).toEqual({ done: 1, total: 1 });
  });

  it('stops on 429/403 and leaves the rest for the next run', async () => {
    likedTrackWithArtists('t1', [{ id: 'a1', name: 'A' }]);
    likedTrackWithArtists('t2', [{ id: 'a2', name: 'B' }]);
    fetchMock
      .mockResolvedValueOnce({ id: 'x', name: 'X', genres: ['pop'] })
      .mockRejectedValueOnce(new SpotifyApiError('quota', 429));

    const processed = await runArtistGenreSync({ sleepFn: noSleep });

    expect(processed).toBe(1);
    expect(getGenreSyncCounts()).toEqual({ done: 1, total: 2 });
  });

  it('honors the time budget', async () => {
    likedTrackWithArtists('t1', [{ id: 'a1', name: 'A' }]);
    likedTrackWithArtists('t2', [{ id: 'a2', name: 'B' }]);
    fetchMock.mockResolvedValue({ id: 'x', name: 'X', genres: [] });

    const processed = await runArtistGenreSync({ sleepFn: noSleep, maxDurationMs: 0 });

    expect(processed).toBe(0);
  });

  it('emits progress events and refuses concurrent runs', async () => {
    likedTrackWithArtists('t1', [{ id: 'a1', name: 'A' }]);
    let release!: () => void;
    fetchMock.mockImplementation(() => new Promise((r) => { release = () => r({ id: 'a1', name: 'A', genres: [] }); }));
    const events: unknown[] = [];
    genreSyncEvents.on('progress', (p) => events.push(p));

    const first = runArtistGenreSync({ sleepFn: noSleep });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await runArtistGenreSync({ sleepFn: noSleep })).toBe(0);
    release();
    await first;

    expect(events.at(-1)).toEqual({ done: 1, total: 1, running: false });
    genreSyncEvents.removeAllListeners();
  });
});
