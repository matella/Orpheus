import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';

vi.mock('../src/api/websocket.js', () => ({ broadcast: vi.fn() }));
vi.mock('../src/spotify/player.js', () => ({
  createSpotifyPlaylist: vi.fn(),
  addTracksToPlaylist: vi.fn(),
}));
vi.mock('../src/spotify/artist-genre-sync.js', async (orig) => ({
  ...(await orig<typeof import('../src/spotify/artist-genre-sync.js')>()),
  runArtistGenreSync: vi.fn().mockResolvedValue(0),
}));

import { createSpotifyPlaylist, addTracksToPlaylist } from '../src/spotify/player.js';
import { PlaylistPartialError } from '../src/shared/errors.js';
import { errorHandler } from '../src/api/middleware/error-handler.js';
import { libraryRoutes, genrePlaylistRoutes } from '../src/api/routes/genre-playlist.routes.js';
import { loadGenreFamilies } from '../src/intelligence/genre-families.js';
import { createTestDb, insertTestTrack } from './helpers/db.js';
import { upsertArtistNames, setTrackArtists, saveArtistGenres } from '../src/database/repositories/artist.repo.js';

let app: FastifyInstance;
let db: DatabaseSync;

beforeAll(async () => {
  loadGenreFamilies();
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(libraryRoutes, { prefix: '/api/library' });
  await app.register(genrePlaylistRoutes, { prefix: '/api/genre-playlists' });
  await app.ready();
});
afterAll(() => app.close());

beforeEach(() => {
  db = createTestDb();
  vi.mocked(createSpotifyPlaylist).mockReset();
  vi.mocked(addTracksToPlaylist).mockReset();
});

function kpopTrack(spotifyId: string): number {
  const id = insertTestTrack(db, { spotifyId, likedAt: '2024-01-01T00:00:00Z', artistId: 'aespa' });
  upsertArtistNames([{ id: 'aespa', name: 'aespa' }]);
  saveArtistGenres('aespa', 'aespa', ['k-pop']);
  setTrackArtists(id, ['aespa']);
  return id;
}

describe('GET /api/library/genres', () => {
  it('returns families and sync progress', async () => {
    kpopTrack('t1');
    const res = await app.inject({ method: 'GET', url: '/api/library/genres' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.families[0]).toMatchObject({ id: 'k-pop', trackCount: 1 });
    expect(body.genreSyncProgress).toEqual({ done: 1, total: 1, running: false });
  });
});

describe('POST /api/genre-playlists/preview', () => {
  it('400 when no family or genre is given', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/genre-playlists/preview', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('400 on a malformed date', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/genre-playlists/preview',
      payload: { families: ['k-pop'], likedFrom: '01/02/2024' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns matching tracks', async () => {
    kpopTrack('t1');
    const res = await app.inject({ method: 'POST', url: '/api/genre-playlists/preview', payload: { families: ['k-pop'] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().tracks).toHaveLength(1);
  });
});

describe('GET /api/library/artists/:artistId/liked-tracks', () => {
  it('404 for an unknown artist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/library/artists/nobody/liked-tracks' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/genre-playlists/order', () => {
  it('400 when features are unavailable', async () => {
    const id = kpopTrack('t1');
    const res = await app.inject({ method: 'POST', url: '/api/genre-playlists/order', payload: { trackIds: [id] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('FEATURES_UNAVAILABLE');
  });
});

describe('POST /api/genre-playlists/export', () => {
  const payload = (trackIds: number[]) => ({ trackIds, name: 'K-pop — Orpheus', description: '', isPublic: false, families: ['k-pop'] });

  it('400 on empty or > 10000 track lists', async () => {
    for (const ids of [[], Array.from({ length: 10001 }, (_, i) => i + 1)]) {
      const res = await app.inject({ method: 'POST', url: '/api/genre-playlists/export', payload: payload(ids) });
      expect(res.statusCode).toBe(400);
    }
  });

  it('400 on unknown track ids', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/genre-playlists/export', payload: payload([424242]) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('UNKNOWN_TRACKS');
  });

  it('creates the playlist in order and persists it', async () => {
    const a = kpopTrack('a');
    const b = kpopTrack('b');
    vi.mocked(createSpotifyPlaylist).mockResolvedValue({ id: 'pl1', url: 'https://open.spotify.com/playlist/pl1' });
    vi.mocked(addTracksToPlaylist).mockResolvedValue(2);

    const res = await app.inject({ method: 'POST', url: '/api/genre-playlists/export', payload: payload([b, a]) });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ spotifyPlaylistId: 'pl1', trackCount: 2, addedCount: 2, partial: false });
    expect(vi.mocked(addTracksToPlaylist).mock.calls[0][1]).toEqual(['spotify:track:b', 'spotify:track:a']);
    expect(db.prepare('SELECT prompt, track_count FROM playlists').get()).toEqual({ prompt: 'genre:k-pop', track_count: 2 });
  });

  it('reports partial failures', async () => {
    const a = kpopTrack('a');
    vi.mocked(createSpotifyPlaylist).mockResolvedValue({ id: 'pl1', url: 'u' });
    vi.mocked(addTracksToPlaylist).mockRejectedValue(new PlaylistPartialError('x', 0));

    const res = await app.inject({ method: 'POST', url: '/api/genre-playlists/export', payload: payload([a]) });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ partial: true, addedCount: 0, spotifyPlaylistUrl: 'u' });
  });
});
