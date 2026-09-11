import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createTestDb, insertTestTrack } from './helpers/db.js';
import {
  upsertLikedTracks,
  clearUnlikedTracks,
  markTracksWithDefaultFeatures,
  updateAudioFeatures,
} from '../src/database/repositories/track.repo.js';

let db: DatabaseSync;
beforeEach(() => { db = createTestDb(); });

const liked = (spotifyId: string, likedAt: string, artists: { id: string; name: string }[]) => ({
  spotifyId,
  name: `Song ${spotifyId}`,
  artist: artists.map((a) => a.name).join(', '),
  artistId: artists[0]?.id,
  durationMs: 200000,
  source: 'library',
  likedAt,
  artists,
});

describe('upsertLikedTracks', () => {
  it('stores liked_at, every artist, and artist names', () => {
    upsertLikedTracks([
      liked('t1', '2024-05-01T10:00:00Z', [{ id: 'a1', name: 'aespa' }, { id: 'a2', name: 'Feat Guy' }]),
    ]);

    const track = db.prepare('SELECT id, liked_at FROM tracks WHERE spotify_id = ?').get('t1') as { id: number; liked_at: string };
    expect(track.liked_at).toBe('2024-05-01T10:00:00Z');
    expect(db.prepare('SELECT artist_id, position FROM track_artists WHERE track_id = ? ORDER BY position').all(track.id))
      .toEqual([{ artist_id: 'a1', position: 0 }, { artist_id: 'a2', position: 1 }]);
    expect(db.prepare('SELECT artist_id, name FROM artists ORDER BY artist_id').all())
      .toEqual([{ artist_id: 'a1', name: 'aespa' }, { artist_id: 'a2', name: 'Feat Guy' }]);
  });

  it('replaces the artist list on re-sync and keeps genres_fetched_at', () => {
    upsertLikedTracks([liked('t1', '2024-05-01T10:00:00Z', [{ id: 'a1', name: 'old' }, { id: 'a2', name: 'x' }])]);
    db.prepare("UPDATE artists SET genres_fetched_at = '2026-01-01' WHERE artist_id = 'a1'").run();

    upsertLikedTracks([liked('t1', '2024-05-01T10:00:00Z', [{ id: 'a1', name: 'aespa' }])]);

    expect(db.prepare('SELECT COUNT(*) AS n FROM track_artists').get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT name, genres_fetched_at FROM artists WHERE artist_id = 'a1'").get())
      .toEqual({ name: 'aespa', genres_fetched_at: '2026-01-01' });
  });
});

describe('clearUnlikedTracks', () => {
  it('nulls liked_at for liked tracks not seen in the latest pass', () => {
    insertTestTrack(db, { spotifyId: 'keep', likedAt: '2024-01-01' });
    insertTestTrack(db, { spotifyId: 'gone', likedAt: '2024-01-01' });
    insertTestTrack(db, { spotifyId: 'never', likedAt: null });

    const changed = clearUnlikedTracks(['keep']);

    expect(changed).toBe(1);
    expect(db.prepare('SELECT spotify_id, liked_at FROM tracks ORDER BY spotify_id').all()).toEqual([
      { spotify_id: 'gone', liked_at: null },
      { spotify_id: 'keep', liked_at: '2024-01-01' },
      { spotify_id: 'never', liked_at: null },
    ]);
  });
});

describe('features_source', () => {
  it('is "default" for neutral defaults and "spotify" for fetched features', () => {
    insertTestTrack(db, { spotifyId: 'd' });
    insertTestTrack(db, { spotifyId: 's' });
    updateAudioFeatures({
      spotifyId: 's', energy: 0.8, valence: 0.4, tempo: 128, danceability: 0.7, acousticness: 0.1,
      instrumentalness: 0, loudness: -5, speechiness: 0.05, key: 5, mode: 1, timeSignature: 4,
    });
    markTracksWithDefaultFeatures();

    expect(db.prepare('SELECT spotify_id, features_source FROM tracks ORDER BY spotify_id').all()).toEqual([
      { spotify_id: 'd', features_source: 'default' },
      { spotify_id: 's', features_source: 'spotify' },
    ]);
  });
});
