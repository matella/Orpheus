import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createTestDb, insertTestTrack, type TestTrack } from './helpers/db.js';
import { upsertArtistNames, setTrackArtists, saveArtistGenres } from '../src/database/repositories/artist.repo.js';
import { loadGenreFamilies } from '../src/intelligence/genre-families.js';
import {
  getGenreSummary,
  previewGenrePlaylist,
  getArtistLikedTracks,
  orderTrackIdsSmooth,
  type GenrePreviewFilters,
} from '../src/intelligence/genre-playlist.js';

let db: DatabaseSync;
beforeAll(() => loadGenreFamilies());

function track(t: TestTrack, artists: { id: string; name: string; genres: string[] }[]): number {
  const id = insertTestTrack(db, { likedAt: '2024-06-01T00:00:00Z', ...t, artistId: artists[0]?.id ?? null });
  for (const a of artists) {
    upsertArtistNames([{ id: a.id, name: a.name }]);
    saveArtistGenres(a.id, a.name, a.genres);
  }
  setTrackArtists(id, artists.map((a) => a.id));
  return id;
}

const filters = (f: Partial<GenrePreviewFilters>): GenrePreviewFilters => ({
  families: [], includeGenres: [], excludeGenres: [],
  likedFrom: null, likedTo: null, energyMin: null, energyMax: null, ...f,
});

const AESPA = { id: 'aespa', name: 'aespa', genres: ['k-pop', 'k-pop girl group'] };
const ZICO = { id: 'zico', name: 'ZICO', genres: ['k-rap'] };
const WESTERN = { id: 'west', name: 'Western', genres: ['dance pop'] };

beforeEach(() => { db = createTestDb(); });

describe('previewGenrePlaylist', () => {
  it('matches through a featured artist genre', () => {
    const id = track({ spotifyId: 'feat' }, [WESTERN, AESPA]);
    const res = previewGenrePlaylist(filters({ families: ['k-pop'] }));
    expect(res.tracks.map((t) => t.id)).toEqual([id]);
    expect(res.tracks[0].matchedGenres.sort()).toEqual(['k-pop', 'k-pop girl group']);
    expect(res.tracks[0].artistIds).toEqual(['west', 'aespa']);
  });

  it('excludeGenres wins over family inclusion', () => {
    track({ spotifyId: 'a' }, [AESPA]);
    track({ spotifyId: 'z' }, [ZICO]);
    const res = previewGenrePlaylist(filters({ families: ['k-pop'], excludeGenres: ['k-rap'] }));
    expect(res.tracks.map((t) => t.spotifyId)).toEqual(['a']);
  });

  it('includeGenres adds tracks outside the selected families', () => {
    track({ spotifyId: 'a' }, [AESPA]);
    track({ spotifyId: 'w' }, [WESTERN]);
    const res = previewGenrePlaylist(filters({ families: ['k-pop'], includeGenres: ['dance pop'] }));
    expect(res.tracks.map((t) => t.spotifyId).sort()).toEqual(['a', 'w']);
  });

  it('filters by liked date range (inclusive) and ignores un-liked tracks', () => {
    track({ spotifyId: 'old', likedAt: '2022-12-31T23:00:00Z' }, [AESPA]);
    track({ spotifyId: 'in', likedAt: '2023-06-01T00:00:00Z' }, [AESPA]);
    track({ spotifyId: 'edge', likedAt: '2023-12-31T22:00:00Z' }, [AESPA]);
    track({ spotifyId: 'unliked', likedAt: null }, [AESPA]);
    const res = previewGenrePlaylist(filters({ families: ['k-pop'], likedFrom: '2023-01-01', likedTo: '2023-12-31' }));
    expect(res.tracks.map((t) => t.spotifyId)).toEqual(['edge', 'in']);
  });

  it('uses the AI genre only when no artist has Spotify genres', () => {
    track({ spotifyId: 'ai', genreCluster: 'k-pop', genreSource: 'ai' }, [{ id: 'nog', name: 'NoGenre', genres: [] }]);
    track({ spotifyId: 'spot', genreCluster: 'k-pop', genreSource: 'ai' }, [WESTERN]);
    const res = previewGenrePlaylist(filters({ families: ['k-pop'] }));
    expect(res.tracks.map((t) => t.spotifyId)).toEqual(['ai']);
  });

  it('has no track cap and counts artists', () => {
    for (let i = 0; i < 150; i++) track({ spotifyId: `k${i}` }, [AESPA]);
    const res = previewGenrePlaylist(filters({ families: ['k-pop'] }));
    expect(res.tracks).toHaveLength(150);
    expect(res.artists).toEqual([{ artistId: 'aespa', name: 'aespa', trackCount: 150 }]);
  });

  it('applies energy filters only when real features exist', () => {
    track({ spotifyId: 'lo', energy: 0.2, featuresSource: 'default' }, [AESPA]);
    track({ spotifyId: 'hi', energy: 0.9, featuresSource: 'default' }, [AESPA]);
    expect(previewGenrePlaylist(filters({ families: ['k-pop'], energyMin: 0.5 })).tracks).toHaveLength(2);

    db.prepare("UPDATE tracks SET features_source = 'spotify'").run();
    expect(previewGenrePlaylist(filters({ families: ['k-pop'], energyMin: 0.5 })).tracks.map((t) => t.spotifyId))
      .toEqual(['hi']);
  });
});

describe('getGenreSummary', () => {
  it('counts liked tracks per family and sub-genre, other last', () => {
    track({ spotifyId: 'a1' }, [AESPA]);
    track({ spotifyId: 'a2' }, [AESPA]);
    track({ spotifyId: 'z' }, [ZICO]);
    track({ spotifyId: 'x' }, [{ id: 'odd', name: 'Odd', genres: ['zzz unknown'] }]);
    track({ spotifyId: 'none' }, [{ id: 'bare', name: 'Bare', genres: [] }]);
    track({ spotifyId: 'unliked', likedAt: null }, [AESPA]);

    const s = getGenreSummary();

    expect(s.families[0]).toEqual({
      id: 'k-pop', label: 'K-pop', trackCount: 3,
      genres: [
        { name: 'k-pop', trackCount: 2 },
        { name: 'k-pop girl group', trackCount: 2 },
        { name: 'k-rap', trackCount: 1 },
      ],
    });
    expect(s.families.at(-1)).toMatchObject({ id: 'other', label: 'Other', trackCount: 1 });
    expect(s.untaggedCount).toBe(1);
    expect(s.featuresAvailable).toBe(false);
  });
});

describe('getArtistLikedTracks / orderTrackIdsSmooth', () => {
  it('returns liked tracks of an artist regardless of genre, null if unknown', () => {
    track({ spotifyId: 'w' }, [WESTERN]);
    expect(getArtistLikedTracks('west')?.map((t) => t.spotifyId)).toEqual(['w']);
    expect(getArtistLikedTracks('nobody')).toBeNull();
  });

  it('orders by smoothness, keeps the first id, drops unknown ids', () => {
    const a = track({ spotifyId: 'a', energy: 0.1 }, [AESPA]);
    const b = track({ spotifyId: 'b', energy: 0.9 }, [AESPA]);
    const c = track({ spotifyId: 'c', energy: 0.2 }, [AESPA]);
    expect(orderTrackIdsSmooth([a, b, c, 9999])).toEqual([a, c, b]);
  });
});
