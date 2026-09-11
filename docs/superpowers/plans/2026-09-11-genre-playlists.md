# Genre Playlists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Spotify playlist from Liked Songs filtered by genre family (e.g. all K-pop), customized in a Flutter preview UI before export.

**Architecture:** Server stores liked dates, all track artists and all artist genres (migration v9), migrates to the Feb-2026 Spotify endpoints, and exposes a stateless preview/export API. The Flutter client holds all customization state (unchecked tracks, excluded/forced artists, sort, limit) and sends the final ordered track IDs to export.

**Tech Stack:** Node 24 + TypeScript (ESM, Node16 resolution), Fastify 5, `node:sqlite`, Zod 4, vitest 4; Flutter 3.47.3 / Dart 3.13, Riverpod 3 (`Notifier`), Dio.

**Spec:** `docs/superpowers/specs/2026-09-11-genre-playlists-design.md`

## Global Constraints

- ESM only; relative imports end in `.js` (Node16 resolution).
- `node:sqlite` only; batch writes use `SAVEPOINT` / `RELEASE` / `ROLLBACK TO` (no `db.transaction()`).
- Spotify endpoints: `POST /me/playlists`, `POST /playlists/{id}/items` (batches of 100), `GET /artists/{id}` (one at a time). Never `POST /users/{id}/playlists`, `/playlists/{id}/tracks`, or `GET /artists?ids=`.
- AI stays optional: nothing new may depend on Ollama.
- Existing engine behavior must not change: `tracks.genre_cluster` keeps being populated.
- Export bounds: 1–10000 track IDs; name 1–100 chars; description ≤ 300 chars.
- Flutter: `/Users/matella/Coding/SDK/flutter/bin/flutter` (not on PATH). Baseline `flutter analyze` = 5 pre-existing issues (3 warnings in home/intelligence screens, 2 deprecation infos in settings screen). New code must add **zero** issues.
- Server baseline: `npx tsc --noEmit` exits 0; there are no tests yet.
- Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Map

**Server — create**
- `server/vitest.config.ts` — test env vars + include pattern.
- `server/tests/helpers/db.ts` — in-memory migrated DB + track fixture helper.
- `server/data/genre_families.json` — family → substring patterns.
- `server/src/intelligence/genre-families.ts` — load + classify genres into families.
- `server/src/database/repositories/artist.repo.ts` — `artists`, `artist_genres`, `track_artists` access.
- `server/src/database/repositories/genre-playlist.repo.ts` — liked-track queries for preview/genres/artists.
- `server/src/intelligence/genre-playlist.ts` — preview/genre-summary service (pure logic over repo).
- `server/src/intelligence/track-ordering.ts` — `greedyNearestNeighbor`, `transitionCost` (extracted).
- `server/src/spotify/artist-genre-sync.ts` — throttled per-artist genre sync with progress + guard.
- `server/src/api/routes/genre-playlist.routes.ts` — `/api/library/*` and `/api/genre-playlists/*`.
- Tests: `server/tests/*.test.ts` (one per unit, listed per task).

**Server — modify**
- `server/src/database/connection.ts` — `setDbForTesting()`.
- `server/src/database/migrations.ts` — `targetVersion` param + `migrateV9`.
- `server/src/database/types.ts` — `TrackRow.liked_at`, `TrackRow.features_source`.
- `server/src/database/repositories/track.repo.ts` — liked upsert, un-like sweep, `features_source`.
- `server/src/spotify/player.ts` — new playlist endpoints.
- `server/src/spotify/library.ts` — `syncSavedTracks`, `syncAudioFeatures`, `syncArtistGenres` delegation.
- `server/src/shared/errors.ts` — `PlaylistPartialError`.
- `server/src/intelligence/playlist-generator.ts` — import ordering from `track-ordering.ts`.
- `server/src/api/server.ts` — register new routes.
- `server/src/index.ts` — `loadGenreFamilies()` at startup.

**Client — create**
- `client/lib/models/genre_builder_models.dart` — plain data classes + JSON parsing.
- `client/lib/providers/genre_builder_provider.dart` — `GenreBuilderNotifier`.
- `client/lib/widgets/genre_builder/genre_family_picker.dart`
- `client/lib/widgets/genre_builder/artist_filter_panel.dart`
- `client/lib/widgets/genre_builder/secondary_filters.dart`
- `client/lib/widgets/genre_builder/track_preview_list.dart`
- `client/lib/widgets/genre_builder/export_bar.dart` (bar + sheet)
- `client/lib/widgets/genre_builder/genre_playlist_builder.dart` — responsive layout.
- `client/test/genre_builder_models_test.dart`, `client/test/genre_builder_derive_test.dart`, `client/test/genre_family_picker_test.dart`

**Client — modify**
- `client/lib/services/api_service.dart` — 7 new methods.
- `client/lib/screens/playlist_screen.dart` — mode `SegmentedButton`.

**Docs — modify:** `CLAUDE.md`, `README.md`.

---

### Task 0: Commit toolchain lockfile updates

`flutter pub get` (Flutter 3.47.3) and `npm install` already modified three files. Commit them alone so feature diffs stay clean.

**Files:**
- Modify: `client/pubspec.lock`, `client/analysis_options.yaml` (adds `analyzer.exclude: [build/**, web/**]`), `server/package-lock.json`

- [ ] **Step 1: Verify only these three files are dirty**

Run: `git status --short`
Expected exactly:
```
 M client/analysis_options.yaml
 M client/pubspec.lock
 M server/package-lock.json
```

- [ ] **Step 2: Commit**

```bash
git add client/analysis_options.yaml client/pubspec.lock server/package-lock.json
git commit -m "chore: refresh lockfiles for Flutter 3.47.3 and npm install

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 1: Spotify playlist endpoint migration

**Files:**
- Create: `server/vitest.config.ts`
- Modify: `server/src/shared/errors.ts` (append), `server/src/spotify/player.ts:164-199`
- Test: `server/tests/spotify-playlist.test.ts`

**Interfaces:**
- Produces:
  - `createSpotifyPlaylist(name: string, description: string, isPublic?: boolean): Promise<{ id: string; url: string }>` — unchanged signature.
  - `addTracksToPlaylist(playlistId: string, uris: string[]): Promise<number>` — returns count added.
  - `class PlaylistPartialError extends SpotifyApiError { readonly addedCount: number }` — thrown when a batch fails after ≥ 0 were added.

- [ ] **Step 1: Create vitest config**

`server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    env: {
      SPOTIFY_CLIENT_ID: 'test-client-id',
      SPOTIFY_CLIENT_SECRET: 'test-client-secret',
      LOG_LEVEL: 'fatal',
      DB_PATH: ':memory:',
    },
  },
});
```

- [ ] **Step 2: Write the failing test**

`server/tests/spotify-playlist.test.ts`:
```ts
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
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run tests/spotify-playlist.test.ts`
Expected: FAIL — `PlaylistPartialError` is not exported / calls go to `/users/.../playlists`.

- [ ] **Step 4: Add the error class**

Append to `server/src/shared/errors.ts`:
```ts
/**
 * Thrown when adding tracks to a playlist fails part-way.
 * `addedCount` is the number of URIs successfully added before the failure.
 */
export class PlaylistPartialError extends SpotifyApiError {
  constructor(message: string, public readonly addedCount: number, statusCode: number = 502) {
    super(message, statusCode);
    this.name = 'PlaylistPartialError';
  }
}
```

- [ ] **Step 5: Update `player.ts`**

Replace `createSpotifyPlaylist` and `addTracksToPlaylist` in `server/src/spotify/player.ts` with:
```ts
/**
 * Create a new playlist on the current user's Spotify account.
 */
export async function createSpotifyPlaylist(
  name: string,
  description: string,
  isPublic: boolean = false,
): Promise<{ id: string; url: string }> {
  const data = await spotifyFetch<{ id: string; external_urls: { spotify: string } }>(
    '/me/playlists',
    {
      method: 'POST',
      body: JSON.stringify({ name, description, public: isPublic }),
    },
  );
  if (!data?.id) throw new Error('Spotify playlist creation returned no data');
  return { id: data.id, url: data.external_urls.spotify };
}

/**
 * Add items to a Spotify playlist in batches of 100 (Spotify limit).
 * Returns the number of URIs added. Throws PlaylistPartialError if a batch fails.
 */
export async function addTracksToPlaylist(
  playlistId: string,
  uris: string[],
): Promise<number> {
  let added = 0;
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    try {
      await spotifyFetch(`/playlists/${playlistId}/items`, {
        method: 'POST',
        body: JSON.stringify({ uris: batch }),
      });
    } catch (err) {
      const status = err instanceof SpotifyApiError ? err.statusCode : 502;
      throw new PlaylistPartialError(
        `Failed adding items to playlist ${playlistId} after ${added} tracks: ${(err as Error).message}`,
        added,
        status,
      );
    }
    added += batch.length;
  }
  return added;
}
```
Add to the imports at the top of `player.ts`: `import { SpotifyApiError, PlaylistPartialError } from '../shared/errors.js';` (merge with an existing `errors.js` import if present).

- [ ] **Step 6: Run tests + typecheck**

Run: `cd server && npx vitest run tests/spotify-playlist.test.ts && npx tsc --noEmit`
Expected: 3 tests PASS; tsc exit 0 (the generator ignores the new return value — fine).

- [ ] **Step 7: Commit**

```bash
git add server/vitest.config.ts server/tests/spotify-playlist.test.ts server/src/shared/errors.ts server/src/spotify/player.ts
git commit -m "fix(spotify): use /me/playlists and /playlists/{id}/items (Feb 2026 API)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration v9 + test DB helper

**Files:**
- Modify: `server/src/database/connection.ts` (append), `server/src/database/migrations.ts`, `server/src/database/types.ts:1-27`
- Create: `server/tests/helpers/db.ts`
- Test: `server/tests/migrations.test.ts`

**Interfaces:**
- Produces:
  - `setDbForTesting(conn: DatabaseSync | null): void`
  - `runMigrations(db: DatabaseSync, targetVersion?: number): void` (default = latest, 9)
  - `createTestDb(targetVersion?: number): DatabaseSync` — in-memory, migrated, installed via `setDbForTesting`.
  - `insertTestTrack(db, t: TestTrack): number` where
    `TestTrack = { spotifyId: string; name?: string; artist?: string; artistId?: string | null; likedAt?: string | null; durationMs?: number; energy?: number | null; featuresSource?: 'spotify' | 'default' | null; genreCluster?: string | null; genreSource?: string | null }`
  - Tables `artists(artist_id PK, name, genres_fetched_at)`, `artist_genres(artist_id, genre)`, `track_artists(track_id, artist_id, position)`; columns `tracks.liked_at`, `tracks.features_source`.

- [ ] **Step 1: Add the test hook to `connection.ts`**

Append:
```ts
/**
 * Test-only: install an already-open connection (e.g. an in-memory DB).
 * Pass null to clear it.
 */
export function setDbForTesting(conn: DatabaseSync | null): void {
  db = conn;
}
```

- [ ] **Step 2: Create the test helper**

`server/tests/helpers/db.ts`:
```ts
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/database/migrations.js';
import { setDbForTesting } from '../../src/database/connection.js';

export function createTestDb(targetVersion?: number): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db, targetVersion);
  setDbForTesting(db);
  return db;
}

export interface TestTrack {
  spotifyId: string;
  name?: string;
  artist?: string;
  artistId?: string | null;
  likedAt?: string | null;
  durationMs?: number;
  energy?: number | null;
  featuresSource?: 'spotify' | 'default' | null;
  genreCluster?: string | null;
  genreSource?: string | null;
}

/** Insert a track row directly. Requires schema v9 for likedAt/featuresSource. */
export function insertTestTrack(db: DatabaseSync, t: TestTrack): number {
  const result = db.prepare(`
    INSERT INTO tracks (spotify_id, name, artist, artist_id, duration_ms, energy,
      features_fetched, genre_cluster, genre_source, liked_at, features_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    t.spotifyId,
    t.name ?? `Track ${t.spotifyId}`,
    t.artist ?? 'Artist',
    t.artistId ?? null,
    t.durationMs ?? 180000,
    t.energy ?? null,
    t.energy != null ? 1 : 0,
    t.genreCluster ?? null,
    t.genreSource ?? null,
    t.likedAt ?? null,
    t.featuresSource ?? null,
  );
  return Number(result.lastInsertRowid);
}
```

- [ ] **Step 3: Write the failing test**

`server/tests/migrations.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from './helpers/db.js';
import { runMigrations } from '../src/database/migrations.js';

function columns(db: ReturnType<typeof createTestDb>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe('migration v9', () => {
  it('adds liked_at, features_source and the artist tables', () => {
    const db = createTestDb();
    expect(columns(db, 'tracks')).toEqual(expect.arrayContaining(['liked_at', 'features_source']));
    expect(columns(db, 'artists')).toEqual(['artist_id', 'name', 'genres_fetched_at']);
    expect(columns(db, 'artist_genres')).toEqual(['artist_id', 'genre']);
    expect(columns(db, 'track_artists')).toEqual(['track_id', 'artist_id', 'position']);
    expect((db.prepare('SELECT version FROM schema_meta').get() as { version: number }).version).toBe(9);
  });

  it('backfills a v8 database', () => {
    const db = createTestDb(8);
    const insert = db.prepare(`
      INSERT INTO tracks (spotify_id, name, artist, artist_id, duration_ms, features_fetched,
        energy, valence, tempo, danceability, acousticness, instrumentalness, loudness, speechiness)
      VALUES (?, ?, ?, ?, 1000, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Neutral defaults written by markTracksWithDefaultFeatures()
    insert.run('def', 'Default', 'aespa', 'a1', 0.5, 0.5, 120, 0.5, 0.5, 0.1, -10, 0.1);
    // Real Spotify features
    insert.run('real', 'Real', 'Tyler, The Creator, Kali Uchis', 'a2', 0.8, 0.3, 98, 0.7, 0.1, 0, -5, 0.2);

    runMigrations(db);

    const src = db.prepare('SELECT spotify_id, features_source FROM tracks ORDER BY spotify_id').all();
    expect(src).toEqual([
      { spotify_id: 'def', features_source: 'default' },
      { spotify_id: 'real', features_source: 'spotify' },
    ]);
    const ta = db.prepare('SELECT artist_id, position FROM track_artists ORDER BY artist_id').all();
    expect(ta).toEqual([{ artist_id: 'a1', position: 0 }, { artist_id: 'a2', position: 0 }]);
    const artists = db.prepare('SELECT artist_id, name, genres_fetched_at FROM artists ORDER BY artist_id').all();
    expect(artists).toEqual([
      { artist_id: 'a1', name: 'aespa', genres_fetched_at: null },
      { artist_id: 'a2', name: 'Tyler', genres_fetched_at: null },
    ]);
  });

  it('is idempotent', () => {
    const db = createTestDb();
    expect(() => runMigrations(db)).not.toThrow();
  });
});
```
(The `'Tyler'` backfill name is a known limitation of splitting on the first comma; the next saved-tracks sync overwrites it with the real name.)

- [ ] **Step 4: Run test to verify it fails**

Run: `cd server && npx vitest run tests/migrations.test.ts`
Expected: FAIL — `setDbForTesting`/`targetVersion` unsupported, `liked_at` missing.

- [ ] **Step 5: Add `targetVersion` and `migrateV9`**

In `server/src/database/migrations.ts`:
1. Change `const CURRENT_VERSION = 8;` → `const CURRENT_VERSION = 9;`
2. Replace the `runMigrations` function with:
```ts
/**
 * Run all database migrations up to `targetVersion` (default: latest).
 * `targetVersion` exists so tests can build an older schema.
 */
export function runMigrations(db: DatabaseSync, targetVersion: number = CURRENT_VERSION): void {
  const version = getSchemaVersion(db);
  logger.info({ currentVersion: version, targetVersion }, 'Checking database schema');

  const steps: [number, (db: DatabaseSync) => void][] = [
    [1, migrateV1], [2, migrateV2], [3, migrateV3], [4, migrateV4], [5, migrateV5],
    [6, migrateV6], [7, migrateV7], [8, migrateV8], [9, migrateV9],
  ];
  for (const [v, migrate] of steps) {
    if (version < v && targetVersion >= v) migrate(db);
  }

  logger.info({ version: Math.min(targetVersion, CURRENT_VERSION) }, 'Database schema up to date');
}
```
3. Append:
```ts
function migrateV9(db: DatabaseSync): void {
  logger.info('Running migration v9: liked dates, track artists, artist genres');

  const columns = db.prepare('PRAGMA table_info(tracks)').all() as { name: string }[];
  if (!columns.some((c) => c.name === 'liked_at')) {
    db.prepare('ALTER TABLE tracks ADD COLUMN liked_at TEXT').run();
  }
  if (!columns.some((c) => c.name === 'features_source')) {
    db.prepare('ALTER TABLE tracks ADD COLUMN features_source TEXT').run();
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tracks_liked_at ON tracks(liked_at);

    CREATE TABLE IF NOT EXISTS artists (
      artist_id         TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      genres_fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS artist_genres (
      artist_id TEXT NOT NULL REFERENCES artists(artist_id) ON DELETE CASCADE,
      genre     TEXT NOT NULL,
      PRIMARY KEY (artist_id, genre)
    );
    CREATE INDEX IF NOT EXISTS idx_artist_genres_genre ON artist_genres(genre);

    CREATE TABLE IF NOT EXISTS track_artists (
      track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      artist_id TEXT NOT NULL,
      position  INTEGER NOT NULL,
      PRIMARY KEY (track_id, artist_id)
    );
    CREATE INDEX IF NOT EXISTS idx_track_artists_artist ON track_artists(artist_id);
  `);

  // Neutral defaults come from markTracksWithDefaultFeatures(); anything else came from Spotify.
  db.prepare(`
    UPDATE tracks SET features_source = CASE
      WHEN energy = 0.5 AND valence = 0.5 AND tempo = 120 AND danceability = 0.5
       AND acousticness = 0.5 AND instrumentalness = 0.1 AND loudness = -10 AND speechiness = 0.1
      THEN 'default' ELSE 'spotify' END
    WHERE features_fetched = 1 AND features_source IS NULL
  `).run();

  // Backfill primary artists; names are approximated (first comma segment) until the next sync.
  db.prepare(`
    INSERT OR IGNORE INTO artists (artist_id, name)
    SELECT artist_id,
           TRIM(CASE WHEN instr(artist, ',') > 0 THEN substr(artist, 1, instr(artist, ',') - 1) ELSE artist END)
    FROM tracks WHERE artist_id IS NOT NULL
    GROUP BY artist_id
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO track_artists (track_id, artist_id, position)
    SELECT id, artist_id, 0 FROM tracks WHERE artist_id IS NOT NULL
  `).run();

  setSchemaVersion(db, 9);
  logger.info('Migration v9 complete');
}
```

- [ ] **Step 6: Extend `TrackRow`**

In `server/src/database/types.ts`, add to `TrackRow` after `features_fetched: number;`:
```ts
  liked_at: string | null;
  features_source: 'spotify' | 'default' | null;
```

- [ ] **Step 7: Run tests + typecheck**

Run: `cd server && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS (6); tsc exit 0.

- [ ] **Step 8: Commit**

```bash
git add server/src/database/connection.ts server/src/database/migrations.ts server/src/database/types.ts server/tests/helpers/db.ts server/tests/migrations.test.ts
git commit -m "feat(db): migration v9 — liked_at, features_source, artists, artist_genres, track_artists

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Liked-songs sync — liked dates, all artists, un-like sweep, features source

**Files:**
- Create: `server/src/database/repositories/artist.repo.ts`
- Modify: `server/src/database/repositories/track.repo.ts`, `server/src/spotify/library.ts:28-70` (`syncSavedTracks`)
- Test: `server/tests/liked-sync.test.ts`

**Interfaces:**
- Consumes: `createTestDb`, `insertTestTrack` (Task 2).
- Produces (`artist.repo.ts`):
  - `interface ArtistRef { id: string; name: string }`
  - `upsertArtistNames(artists: ArtistRef[]): void` — insert or update `name`, never touches `genres_fetched_at`.
  - `setTrackArtists(trackId: number, artistIds: string[]): void` — replaces rows for the track; position = array index.
- Produces (`track.repo.ts`):
  - `interface LikedTrackData extends UpsertTrackData { likedAt: string; artists: ArtistRef[] }`
  - `upsertLikedTracks(tracks: LikedTrackData[]): void`
  - `clearUnlikedTracks(seenSpotifyIds: string[]): number` — sets `liked_at = NULL` on liked tracks not in the list; returns rows changed.
  - `updateAudioFeatures` now also sets `features_source = 'spotify'`; `markTracksWithDefaultFeatures` sets `features_source = 'default'`.

- [ ] **Step 1: Write the failing test**

`server/tests/liked-sync.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/liked-sync.test.ts`
Expected: FAIL — `upsertLikedTracks` / `clearUnlikedTracks` not exported.

- [ ] **Step 3: Create `artist.repo.ts`**

`server/src/database/repositories/artist.repo.ts`:
```ts
import { getDb } from '../connection.js';

export interface ArtistRef {
  id: string;
  name: string;
}

/**
 * Insert artists or refresh their names. Never touches genres_fetched_at.
 */
export function upsertArtistNames(artists: ArtistRef[]): void {
  const stmt = getDb().prepare(`
    INSERT INTO artists (artist_id, name) VALUES (?, ?)
    ON CONFLICT(artist_id) DO UPDATE SET name = excluded.name
  `);
  for (const a of artists) stmt.run(a.id, a.name);
}

/**
 * Replace the artist list of a track. Position = index in the array.
 */
export function setTrackArtists(trackId: number, artistIds: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM track_artists WHERE track_id = ?').run(trackId);
  const stmt = db.prepare('INSERT OR IGNORE INTO track_artists (track_id, artist_id, position) VALUES (?, ?, ?)');
  artistIds.forEach((id, i) => stmt.run(trackId, id, i));
}
```

- [ ] **Step 4: Extend `track.repo.ts`**

1. Add imports at the top:
```ts
import { upsertArtistNames, setTrackArtists, type ArtistRef } from './artist.repo.js';
```
2. In `updateAudioFeatures`, change `features_fetched = 1` to `features_fetched = 1, features_source = 'spotify'`.
3. In `markTracksWithDefaultFeatures`, change `features_fetched = 1` to `features_fetched = 1, features_source = 'default'`.
4. Add after `upsertTracks`:
```ts
export interface LikedTrackData extends UpsertTrackData {
  likedAt: string;
  artists: ArtistRef[];
}

/**
 * Upsert tracks from the user's Liked Songs: base track data, liked date,
 * the full artist list, and artist names. Runs in one SAVEPOINT.
 */
export function upsertLikedTracks(tracks: LikedTrackData[]): void {
  const db = getDb();
  db.prepare('SAVEPOINT upsert_liked').run();
  try {
    upsertTracks(tracks);
    const setLiked = db.prepare('UPDATE tracks SET liked_at = ? WHERE spotify_id = ?');
    const getId = db.prepare('SELECT id FROM tracks WHERE spotify_id = ?');
    for (const t of tracks) {
      setLiked.run(t.likedAt, t.spotifyId);
      const row = getId.get(t.spotifyId) as { id: number } | undefined;
      if (!row) continue;
      upsertArtistNames(t.artists);
      setTrackArtists(row.id, t.artists.map((a) => a.id));
    }
    db.prepare('RELEASE upsert_liked').run();
  } catch (err) {
    db.prepare('ROLLBACK TO upsert_liked').run();
    throw err;
  }
}

/**
 * After a complete Liked Songs pass, un-like tracks that were not seen.
 * Returns the number of tracks whose liked_at was cleared.
 */
export function clearUnlikedTracks(seenSpotifyIds: string[]): number {
  const db = getDb();
  db.prepare('SAVEPOINT clear_unliked').run();
  try {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS seen_liked (spotify_id TEXT PRIMARY KEY)');
    db.exec('DELETE FROM seen_liked');
    const insert = db.prepare('INSERT OR IGNORE INTO seen_liked (spotify_id) VALUES (?)');
    for (const id of seenSpotifyIds) insert.run(id);
    const result = db.prepare(`
      UPDATE tracks SET liked_at = NULL
      WHERE liked_at IS NOT NULL AND spotify_id NOT IN (SELECT spotify_id FROM seen_liked)
    `).run();
    db.prepare('RELEASE clear_unliked').run();
    return Number(result.changes);
  } catch (err) {
    db.prepare('ROLLBACK TO clear_unliked').run();
    throw err;
  }
}
```
(`upsertTracks` opens its own nested SAVEPOINT — nested savepoints are valid in SQLite.)

- [ ] **Step 5: Run the repo tests**

Run: `cd server && npx vitest run tests/liked-sync.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 6: Update `syncSavedTracks` in `library.ts`**

Replace the whole function with:
```ts
/**
 * Sync all saved tracks (Liked Songs) from the user's Spotify library.
 * Records liked dates and every artist. After a complete pass, tracks no
 * longer liked get liked_at = NULL.
 */
export async function syncSavedTracks(): Promise<number> {
  logger.info('Starting saved tracks sync...');
  let total = 0;
  let offset = 0;
  const limit = 50; // Spotify max per page
  const seen: string[] = [];

  while (true) {
    const data = await spotifyFetch<{
      items: any[];
      total: number;
      next: string | null;
    }>(`/me/tracks?limit=${limit}&offset=${offset}`);

    if (!data.items || data.items.length === 0) break;

    const tracks: LikedTrackData[] = data.items
      .filter((item: any) => item.track?.id)
      .map((item: any) => ({
        spotifyId: item.track.id,
        name: item.track.name,
        artist: item.track.artists.map((a: any) => a.name).join(', '),
        artistId: item.track.artists[0]?.id ?? undefined,
        album: item.track.album?.name,
        albumArtUrl: item.track.album?.images?.[0]?.url,
        durationMs: item.track.duration_ms,
        source: 'library',
        likedAt: item.added_at,
        artists: item.track.artists
          .filter((a: any) => a.id)
          .map((a: any) => ({ id: a.id, name: a.name })),
      }));

    upsertLikedTracks(tracks);
    for (const t of tracks) seen.push(t.spotifyId);
    total += tracks.length;
    offset += limit;

    logger.debug({ synced: total, libraryTotal: data.total }, 'Syncing saved tracks...');

    if (!data.next) break;
  }

  // Only reached when the loop completed without throwing.
  const unliked = clearUnlikedTracks(seen);
  logger.info({ total, unliked }, 'Saved tracks sync complete');
  return total;
}
```
Update the `track.repo.js` import block in `library.ts` to add `upsertLikedTracks`, `clearUnlikedTracks`, `type LikedTrackData`.

- [ ] **Step 7: Run all tests + typecheck**

Run: `cd server && npx vitest run && npx tsc --noEmit`
Expected: all PASS; tsc exit 0.

- [ ] **Step 8: Commit**

```bash
git add server/src/database/repositories/artist.repo.ts server/src/database/repositories/track.repo.ts server/src/spotify/library.ts server/tests/liked-sync.test.ts
git commit -m "feat(sync): store liked dates, all track artists, and un-like sweep

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Genre families

**Files:**
- Create: `server/data/genre_families.json`, `server/src/intelligence/genre-families.ts`
- Modify: `server/src/index.ts` (call `loadGenreFamilies()` next to `loadKnowledgeFiles()`)
- Test: `server/tests/genre-families.test.ts`

**Interfaces:**
- Produces:
  - `interface GenreFamily { id: string; label: string; patterns: string[] }`
  - `const OTHER_FAMILY_ID = 'other'`
  - `loadGenreFamilies(): void` — reads `server/data/genre_families.json`; on failure logs a warning and uses an empty list (everything → `other`).
  - `getGenreFamilies(): GenreFamily[]` — file order.
  - `classifyGenre(genre: string): string` — family id or `'other'`.
  - `familyLabel(id: string): string` — label, `'Other'` for `other`, id itself if unknown.

- [ ] **Step 1: Create the data file**

`server/data/genre_families.json` (order matters — first match wins, so specific families come before broad ones like `pop` and `rock`):
```json
{
  "families": [
    { "id": "k-pop", "label": "K-pop", "patterns": ["k-pop", "kpop", "korean", "k-rap", "k-indie", "k-rock", "k-ballad", "k-r&b", "k-hip hop"] },
    { "id": "j-pop", "label": "J-pop", "patterns": ["j-pop", "jpop", "japanese", "anime", "j-rock", "j-rap", "city pop", "vocaloid"] },
    { "id": "c-pop", "label": "C-pop", "patterns": ["c-pop", "mandopop", "cantopop", "chinese", "taiwanese"] },
    { "id": "latin", "label": "Latin", "patterns": ["latin", "reggaeton", "urbano", "bachata", "salsa", "cumbia", "corrido", "dembow", "sertanejo", "funk carioca"] },
    { "id": "lo-fi", "label": "Lo-fi", "patterns": ["lo-fi", "lofi", "chillhop"] },
    { "id": "hip-hop", "label": "Hip-hop", "patterns": ["hip hop", "hip-hop", "rap", "trap", "drill", "grime", "boom bap"] },
    { "id": "r&b", "label": "R&B", "patterns": ["r&b", "rnb", "neo soul", "new jack swing"] },
    { "id": "soul-funk", "label": "Soul & Funk", "patterns": ["soul", "funk", "motown", "disco"] },
    { "id": "metal", "label": "Metal", "patterns": ["metal", "metalcore", "deathcore", "djent", "grindcore"] },
    { "id": "punk", "label": "Punk", "patterns": ["punk", "emo", "hardcore", "screamo"] },
    { "id": "house", "label": "House", "patterns": ["house"] },
    { "id": "techno", "label": "Techno", "patterns": ["techno", "trance", "hardstyle"] },
    { "id": "electronic", "label": "Electronic", "patterns": ["edm", "electro", "dubstep", "drum and bass", "dnb", "future bass", "synthwave", "idm", "garage", "bass music"] },
    { "id": "ambient", "label": "Ambient", "patterns": ["ambient", "new age", "drone", "meditation"] },
    { "id": "jazz", "label": "Jazz", "patterns": ["jazz", "bebop", "swing", "bossa nova"] },
    { "id": "classical", "label": "Classical", "patterns": ["classical", "orchestra", "baroque", "opera", "romantic era", "soundtrack", "score", "compositional"] },
    { "id": "country", "label": "Country", "patterns": ["country", "bluegrass", "americana", "honky tonk"] },
    { "id": "folk", "label": "Folk", "patterns": ["folk", "singer-songwriter", "acoustic"] },
    { "id": "blues", "label": "Blues", "patterns": ["blues"] },
    { "id": "reggae", "label": "Reggae", "patterns": ["reggae", "dancehall", "ska", "dub"] },
    { "id": "indie", "label": "Indie", "patterns": ["indie", "shoegaze", "dream pop", "bedroom pop", "lo-fi indie"] },
    { "id": "rock", "label": "Rock", "patterns": ["rock", "grunge", "britpop", "post-punk", "new wave"] },
    { "id": "pop", "label": "Pop", "patterns": ["pop", "dance pop", "boy band", "girl group"] }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`server/tests/genre-families.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import {
  loadGenreFamilies,
  getGenreFamilies,
  classifyGenre,
  familyLabel,
  OTHER_FAMILY_ID,
} from '../src/intelligence/genre-families.js';

beforeAll(() => loadGenreFamilies());

describe('classifyGenre', () => {
  it.each([
    ['k-pop', 'k-pop'],
    ['k-pop girl group', 'k-pop'],
    ['K-Pop Boy Group', 'k-pop'],
    ['korean r&b', 'k-pop'],
    ['k-rap', 'k-pop'],
    ['j-pop', 'j-pop'],
    ['anime', 'j-pop'],
    ['dance pop', 'pop'],
    ['alternative r&b', 'r&b'],
    ['melodic drill', 'hip-hop'],
    ['deep house', 'house'],
    ['modern rock', 'rock'],
  ])('%s → %s', (genre, family) => {
    expect(classifyGenre(genre)).toBe(family);
  });

  it('puts unknown genres in "other"', () => {
    expect(classifyGenre('gregorian chant xyz')).toBe(OTHER_FAMILY_ID);
  });
});

describe('families', () => {
  it('loads families in file order with k-pop first', () => {
    const families = getGenreFamilies();
    expect(families.length).toBeGreaterThanOrEqual(20);
    expect(families[0]).toMatchObject({ id: 'k-pop', label: 'K-pop' });
  });

  it('labels', () => {
    expect(familyLabel('k-pop')).toBe('K-pop');
    expect(familyLabel(OTHER_FAMILY_ID)).toBe('Other');
    expect(familyLabel('nope')).toBe('nope');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run tests/genre-families.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `genre-families.ts`**

`server/src/intelligence/genre-families.ts`:
```ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../shared/logger.js';

export interface GenreFamily {
  id: string;
  label: string;
  patterns: string[];
}

export const OTHER_FAMILY_ID = 'other';

let families: GenreFamily[] = [];
const cache = new Map<string, string>();

function getDataDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, '..', '..', 'data');
}

/**
 * Load genre families from data/genre_families.json. On failure every genre
 * classifies as "other" — the feature still works, just without grouping.
 */
export function loadGenreFamilies(): void {
  const path = resolve(getDataDir(), 'genre_families.json');
  cache.clear();
  if (!existsSync(path)) {
    logger.warn({ path }, 'Genre families file not found — all genres grouped as "other"');
    families = [];
    return;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { families: GenreFamily[] };
    families = parsed.families.map((f) => ({ ...f, patterns: f.patterns.map((p) => p.toLowerCase()) }));
    logger.info({ families: families.length }, 'Loaded genre families');
  } catch (err) {
    logger.warn({ err, path }, 'Failed to load genre families');
    families = [];
  }
}

export function getGenreFamilies(): GenreFamily[] {
  return families;
}

/**
 * Family id of a Spotify genre: the first family (file order) with a pattern
 * contained in the lower-cased genre, else "other".
 */
export function classifyGenre(genre: string): string {
  const key = genre.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const match = families.find((f) => f.patterns.some((p) => key.includes(p)));
  const id = match?.id ?? OTHER_FAMILY_ID;
  cache.set(key, id);
  return id;
}

export function familyLabel(id: string): string {
  if (id === OTHER_FAMILY_ID) return 'Other';
  return families.find((f) => f.id === id)?.label ?? id;
}
```

- [ ] **Step 5: Run the test**

Run: `cd server && npx vitest run tests/genre-families.test.ts`
Expected: PASS. If a `it.each` row fails, fix the **data file ordering/patterns**, not the test (e.g. `korean r&b` must hit `k-pop` before `r&b` — it does because `k-pop` is first).

- [ ] **Step 6: Load at startup**

In `server/src/index.ts` add `import { loadGenreFamilies } from './intelligence/genre-families.js';` and call `loadGenreFamilies();` on the line right after `loadKnowledgeFiles();`.

- [ ] **Step 7: Typecheck + commit**

Run: `cd server && npx vitest run && npx tsc --noEmit` — Expected: PASS, exit 0.
```bash
git add server/data/genre_families.json server/src/intelligence/genre-families.ts server/src/index.ts server/tests/genre-families.test.ts
git commit -m "feat(genres): genre families grouping Spotify genres

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Per-artist genre sync (`GET /artists/{id}`)

**Files:**
- Modify: `server/src/database/repositories/artist.repo.ts` (append)
- Create: `server/src/spotify/artist-genre-sync.ts`
- Modify: `server/src/spotify/library.ts` (`syncArtistGenres` delegates; drop `getArtistIdsMissingGenres` import)
- Test: `server/tests/artist-genre-sync.test.ts`

**Interfaces:**
- Consumes: `ArtistRef`, `upsertArtistNames` (Task 3); `setGenreClusterByArtist(artistId, genre)` (existing, `track.repo.ts`).
- Produces (`artist.repo.ts`):
  - `backfillPrimaryArtists(): void` — adds `artists`/`track_artists` rows for tracks whose primary `artist_id` is unknown (tracks from top/recent/search syncs).
  - `getArtistsNeedingGenres(limit: number): string[]` — `genres_fetched_at IS NULL`, liked-track artists first.
  - `saveArtistGenres(artistId: string, name: string | null, genres: string[]): void` — replaces genres, sets `genres_fetched_at = datetime('now')`.
  - `getGenreSyncCounts(): { done: number; total: number }` — over artists linked to liked tracks.
- Produces (`artist-genre-sync.ts`):
  - `interface GenreSyncProgress { done: number; total: number; running: boolean }`
  - `const genreSyncEvents: EventEmitter` — emits `'progress'` with `GenreSyncProgress`.
  - `isGenreSyncRunning(): boolean`
  - `getGenreSyncProgress(): GenreSyncProgress`
  - `runArtistGenreSync(opts?: { maxDurationMs?: number; delayMs?: number; sleepFn?: (ms: number) => Promise<void> }): Promise<number>` — returns artists processed; resolves `0` immediately if already running. Default `delayMs = 200` (≈5 req/s).

- [ ] **Step 1: Write the failing test**

`server/tests/artist-genre-sync.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/artist-genre-sync.test.ts`
Expected: FAIL — module `artist-genre-sync.js` not found.

- [ ] **Step 3: Append repo functions to `artist.repo.ts`**

```ts
/**
 * Ensure every track's primary artist exists in `artists` / `track_artists`.
 * Covers tracks added by top-tracks, recently-played, and search syncs.
 */
export function backfillPrimaryArtists(): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO artists (artist_id, name)
    SELECT artist_id,
           TRIM(CASE WHEN instr(artist, ',') > 0 THEN substr(artist, 1, instr(artist, ',') - 1) ELSE artist END)
    FROM tracks WHERE artist_id IS NOT NULL
    GROUP BY artist_id
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO track_artists (track_id, artist_id, position)
    SELECT t.id, t.artist_id, 0 FROM tracks t
    WHERE t.artist_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM track_artists ta WHERE ta.track_id = t.id)
  `).run();
}

/**
 * Artists whose genres were never fetched — artists of liked tracks first.
 */
export function getArtistsNeedingGenres(limit: number): string[] {
  const rows = getDb().prepare(`
    SELECT a.artist_id,
           EXISTS (
             SELECT 1 FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
             WHERE ta.artist_id = a.artist_id AND t.liked_at IS NOT NULL
           ) AS liked
    FROM artists a
    WHERE a.genres_fetched_at IS NULL
    ORDER BY liked DESC, a.artist_id
    LIMIT ?
  `).all(limit) as { artist_id: string }[];
  return rows.map((r) => r.artist_id);
}

/**
 * Replace an artist's genres and mark it fetched (also when genres is empty).
 */
export function saveArtistGenres(artistId: string, name: string | null, genres: string[]): void {
  const db = getDb();
  db.prepare('SAVEPOINT save_artist_genres').run();
  try {
    db.prepare('DELETE FROM artist_genres WHERE artist_id = ?').run(artistId);
    const insert = db.prepare('INSERT OR IGNORE INTO artist_genres (artist_id, genre) VALUES (?, ?)');
    for (const g of genres) insert.run(artistId, g.toLowerCase());
    db.prepare(`
      UPDATE artists SET genres_fetched_at = datetime('now'), name = COALESCE(?, name)
      WHERE artist_id = ?
    `).run(name, artistId);
    db.prepare('RELEASE save_artist_genres').run();
  } catch (err) {
    db.prepare('ROLLBACK TO save_artist_genres').run();
    throw err;
  }
}

/**
 * Genre-sync progress over artists that appear on liked tracks.
 */
export function getGenreSyncCounts(): { done: number; total: number } {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(a.genres_fetched_at IS NOT NULL), 0) AS done
    FROM artists a
    WHERE EXISTS (
      SELECT 1 FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
      WHERE ta.artist_id = a.artist_id AND t.liked_at IS NOT NULL
    )
  `).get() as { total: number; done: number };
  return { done: row.done, total: row.total };
}
```

- [ ] **Step 4: Implement `artist-genre-sync.ts`**

`server/src/spotify/artist-genre-sync.ts`:
```ts
import { EventEmitter } from 'node:events';
import { spotifyFetch } from './client.js';
import { SpotifyApiError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import { sleep } from '../shared/utils.js';
import {
  backfillPrimaryArtists,
  getArtistsNeedingGenres,
  saveArtistGenres,
  getGenreSyncCounts,
} from '../database/repositories/artist.repo.js';
import { setGenreClusterByArtist } from '../database/repositories/track.repo.js';

export interface GenreSyncProgress {
  done: number;
  total: number;
  running: boolean;
}

/** Emits 'progress' (GenreSyncProgress). Wired to WebSocket in genre-playlist.routes.ts. */
export const genreSyncEvents = new EventEmitter();

let running = false;

export function isGenreSyncRunning(): boolean {
  return running;
}

export function getGenreSyncProgress(): GenreSyncProgress {
  return { ...getGenreSyncCounts(), running };
}

const BATCH = 50;
const PROGRESS_EVERY = 10;

/**
 * Fetch genres for every artist with genres_fetched_at IS NULL, one
 * GET /artists/{id} at a time (batch GET /artists was removed for
 * Development Mode apps in Feb 2026).
 *
 * Throttled by `delayMs` between calls. Stops early (and resumes next run)
 * on 429 (spotifyFetch already retried with Retry-After) or 403, or when
 * `maxDurationMs` elapses. Returns the number of artists processed.
 */
export async function runArtistGenreSync(opts: {
  maxDurationMs?: number;
  delayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
} = {}): Promise<number> {
  if (running) {
    logger.debug('Artist genre sync already running — skipping');
    return 0;
  }
  const { maxDurationMs = Infinity, delayMs = 200, sleepFn = sleep } = opts;
  const deadline = Date.now() + maxDurationMs;
  running = true;
  let processed = 0;

  try {
    backfillPrimaryArtists();
    genreSyncEvents.emit('progress', getGenreSyncProgress());

    outer: while (true) {
      const ids = getArtistsNeedingGenres(BATCH);
      if (ids.length === 0) break;

      for (const id of ids) {
        if (Date.now() >= deadline) {
          logger.info({ processed }, 'Artist genre sync time budget reached — resuming next run');
          break outer;
        }
        try {
          const artist = await spotifyFetch<{ id: string; name: string; genres?: string[] }>(`/artists/${id}`);
          const genres = artist?.genres ?? [];
          saveArtistGenres(id, artist?.name ?? null, genres);
          if (genres.length > 0) setGenreClusterByArtist(id, genres[0]);
        } catch (err) {
          if (err instanceof SpotifyApiError && err.statusCode === 404) {
            saveArtistGenres(id, null, []);
          } else if (err instanceof SpotifyApiError && (err.statusCode === 429 || err.statusCode === 403)) {
            logger.warn({ status: err.statusCode, processed }, 'Artist genre sync stopped by Spotify — resuming next run');
            break outer;
          } else {
            throw err;
          }
        }
        processed++;
        if (processed % PROGRESS_EVERY === 0) genreSyncEvents.emit('progress', getGenreSyncProgress());
        await sleepFn(delayMs);
      }
    }

    logger.info({ processed }, 'Artist genre sync complete');
    return processed;
  } finally {
    running = false;
    genreSyncEvents.emit('progress', getGenreSyncProgress());
  }
}
```

- [ ] **Step 5: Delegate from `library.ts`**

Replace the body of `syncArtistGenres` in `server/src/spotify/library.ts`:
```ts
/**
 * Populate artist genres (all genres, per artist) and tracks.genre_cluster.
 * Bounded to 4 minutes per call so the scheduler's 5-minute task timeout
 * is never hit; the remainder resumes on the next run.
 */
export async function syncArtistGenres(): Promise<number> {
  return runArtistGenreSync({ maxDurationMs: 4 * 60 * 1000 });
}
```
Add `import { runArtistGenreSync } from './artist-genre-sync.js';`; remove `getArtistIdsMissingGenres` and `setGenreClusterByArtist` from the `track.repo.js` import in `library.ts` (keep the functions in `track.repo.ts`; `setGenreClusterByArtist` is now used by `artist-genre-sync.ts`).

- [ ] **Step 6: Run all tests + typecheck**

Run: `cd server && npx vitest run && npx tsc --noEmit`
Expected: all PASS; tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add server/src/database/repositories/artist.repo.ts server/src/spotify/artist-genre-sync.ts server/src/spotify/library.ts server/tests/artist-genre-sync.test.ts
git commit -m "feat(sync): per-artist genre sync via GET /artists/{id} with budget and resume

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Extract track ordering into a shared module

Pure refactor so the genre builder can reuse the generator's nearest-neighbor ordering.

**Files:**
- Create: `server/src/intelligence/track-ordering.ts`
- Modify: `server/src/intelligence/playlist-generator.ts:490-526` (delete the two functions, import them)
- Test: `server/tests/track-ordering.test.ts`

**Interfaces:**
- Produces:
  - `transitionCost(a: TrackRow, b: TrackRow): number` — unchanged formula.
  - `greedyNearestNeighbor<T extends { track: TrackRow }>(items: T[]): T[]` — first item stays first.

- [ ] **Step 1: Write the failing test**

`server/tests/track-ordering.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { TrackRow } from '../src/database/types.js';
import { greedyNearestNeighbor, transitionCost } from '../src/intelligence/track-ordering.js';

const t = (id: number, energy: number, tempo = 120): TrackRow =>
  ({ id, energy, tempo, valence: 0.5, key: null } as unknown as TrackRow);

describe('track ordering', () => {
  it('transitionCost is 0 for identical tracks', () => {
    expect(transitionCost(t(1, 0.5), t(2, 0.5))).toBe(0);
  });

  it('greedyNearestNeighbor keeps the first item and chains closest energies', () => {
    const items = [t(1, 0.1), t(2, 0.9), t(3, 0.2), t(4, 0.8)].map((track) => ({ track }));
    expect(greedyNearestNeighbor(items).map((i) => i.track.id)).toEqual([1, 3, 4, 2]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run tests/track-ordering.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Create the module**

`server/src/intelligence/track-ordering.ts`:
```ts
import type { TrackRow } from '../database/types.js';

/**
 * Greedy nearest-neighbor ordering by transition cost. The first item stays first.
 */
export function greedyNearestNeighbor<T extends { track: TrackRow }>(items: T[]): T[] {
  if (items.length <= 1) return items;

  const ordered = [items[0]];
  const remaining = new Set(items.slice(1));

  while (remaining.size > 0) {
    const last = ordered[ordered.length - 1].track;
    let best: T | null = null;
    let bestCost = Infinity;

    for (const candidate of remaining) {
      const cost = transitionCost(last, candidate.track);
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
    }

    if (best) {
      ordered.push(best);
      remaining.delete(best);
    }
  }

  return ordered;
}

export function transitionCost(a: TrackRow, b: TrackRow): number {
  const bpmDelta = Math.abs((a.tempo ?? 120) - (b.tempo ?? 120)) / Math.max(1, a.tempo ?? 120);
  const energyDelta = Math.abs((a.energy ?? 0.5) - (b.energy ?? 0.5));
  const valenceDelta = Math.abs((a.valence ?? 0.5) - (b.valence ?? 0.5));
  const keyDelta = (a.key != null && b.key != null && a.key !== b.key) ? 0.3 : 0;
  return bpmDelta + energyDelta + valenceDelta + keyDelta;
}
```

- [ ] **Step 4: Use it from the generator**

In `server/src/intelligence/playlist-generator.ts`: delete the local `greedyNearestNeighbor` and `transitionCost` functions and add `import { greedyNearestNeighbor } from './track-ordering.js';` to the imports. `orderByTransitionSmoothness` keeps calling `greedyNearestNeighbor(segTracks)` unchanged (the generic infers `{ track, score, segment }`).

- [ ] **Step 5: Tests + typecheck + commit**

Run: `cd server && npx vitest run && npx tsc --noEmit` — Expected: PASS, exit 0.
```bash
git add server/src/intelligence/track-ordering.ts server/src/intelligence/playlist-generator.ts server/tests/track-ordering.test.ts
git commit -m "refactor(playlists): extract nearest-neighbor ordering into track-ordering.ts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Genre-playlist repository + service

**Files:**
- Create: `server/src/database/repositories/genre-playlist.repo.ts`, `server/src/intelligence/genre-playlist.ts`
- Test: `server/tests/genre-playlist.test.ts`

**Interfaces:**
- Consumes: `classifyGenre`, `familyLabel`, `getGenreFamilies`, `OTHER_FAMILY_ID`, `loadGenreFamilies` (Task 4); `greedyNearestNeighbor` (Task 6); tables from Task 2; `createTestDb`, `insertTestTrack`, `upsertArtistNames`, `setTrackArtists`, `saveArtistGenres` (Tasks 2–5).
- Produces (`genre-playlist.repo.ts`):
  - `interface LikedTrackGenreRow { id: number; spotify_id: string; name: string; artist: string; album_art_url: string | null; duration_ms: number; liked_at: string; energy: number | null; genre_cluster: string | null; genre_source: string | null; artist_ids: string | null; genres: string | null }` (`artist_ids`, `genres` are comma-joined)
  - `getLikedTracksWithGenres(opts?: { likedFrom?: string | null; likedTo?: string | null; artistId?: string }): LikedTrackGenreRow[]` — ordered by `liked_at DESC`.
  - `getArtistNameMap(): Map<string, string>`
  - `searchLikedArtists(q: string, limit?: number): { artistId: string; name: string; trackCount: number }[]`
  - `likedArtistExists(artistId: string): boolean`
  - `getTracksByIds(ids: number[]): TrackRow[]` — any order.
  - `hasRealFeatures(): boolean` — some liked track has `features_source = 'spotify'`.
- Produces (`genre-playlist.ts`):
  - `interface GenrePreviewFilters { families: string[]; includeGenres: string[]; excludeGenres: string[]; likedFrom: string | null; likedTo: string | null; energyMin: number | null; energyMax: number | null }`
  - `interface PreviewTrack { id: number; spotifyId: string; name: string; artist: string; albumArtUrl: string | null; durationMs: number; likedAt: string; energy: number | null; artistIds: string[]; matchedGenres: string[] }`
  - `interface PreviewArtist { artistId: string; name: string; trackCount: number }`
  - `interface FamilySummary { id: string; label: string; trackCount: number; genres: { name: string; trackCount: number }[] }`
  - `getGenreSummary(): { families: FamilySummary[]; untaggedCount: number; featuresAvailable: boolean }` — families sorted by `trackCount` desc, `other` last, empty families omitted.
  - `previewGenrePlaylist(f: GenrePreviewFilters): { tracks: PreviewTrack[]; artists: PreviewArtist[] }`
  - `getArtistLikedTracks(artistId: string): PreviewTrack[] | null` — `null` if the artist has no liked tracks.
  - `orderTrackIdsSmooth(ids: number[]): number[]` — unknown IDs dropped; first ID stays first.

Genre rule (spec): a track's genres = union of `artist_genres` over all its artists; if empty and `genre_source = 'ai'` and `genre_cluster` is set, `[genre_cluster]`. A track matches when some genre is in a selected family or in `includeGenres`, and no genre is in `excludeGenres`.

- [ ] **Step 1: Write the failing test**

`server/tests/genre-playlist.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run tests/genre-playlist.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement the repository**

`server/src/database/repositories/genre-playlist.repo.ts`:
```ts
import { getDb } from '../connection.js';
import type { TrackRow } from '../types.js';

export interface LikedTrackGenreRow {
  id: number;
  spotify_id: string;
  name: string;
  artist: string;
  album_art_url: string | null;
  duration_ms: number;
  liked_at: string;
  energy: number | null;
  genre_cluster: string | null;
  genre_source: string | null;
  /** Comma-joined artist IDs in track order. */
  artist_ids: string | null;
  /** Comma-joined distinct genres across all the track's artists. */
  genres: string | null;
}

/**
 * All liked tracks with their artists and artist genres, newest like first.
 * likedFrom / likedTo are inclusive YYYY-MM-DD dates.
 */
export function getLikedTracksWithGenres(opts: {
  likedFrom?: string | null;
  likedTo?: string | null;
  artistId?: string;
} = {}): LikedTrackGenreRow[] {
  const conditions = ['t.liked_at IS NOT NULL'];
  const params: string[] = [];
  if (opts.likedFrom) {
    conditions.push('t.liked_at >= ?');
    params.push(opts.likedFrom);
  }
  if (opts.likedTo) {
    conditions.push("t.liked_at < date(?, '+1 day')");
    params.push(opts.likedTo);
  }
  if (opts.artistId) {
    conditions.push('EXISTS (SELECT 1 FROM track_artists x WHERE x.track_id = t.id AND x.artist_id = ?)');
    params.push(opts.artistId);
  }

  return getDb().prepare(`
    SELECT t.id, t.spotify_id, t.name, t.artist, t.album_art_url, t.duration_ms, t.liked_at,
           t.energy, t.genre_cluster, t.genre_source,
           (SELECT group_concat(artist_id, ',')
              FROM (SELECT artist_id FROM track_artists WHERE track_id = t.id ORDER BY position)) AS artist_ids,
           (SELECT group_concat(DISTINCT ag.genre)
              FROM track_artists ta JOIN artist_genres ag ON ag.artist_id = ta.artist_id
             WHERE ta.track_id = t.id) AS genres
    FROM tracks t
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.liked_at DESC, t.id DESC
  `).all(...params) as unknown as LikedTrackGenreRow[];
}

export function getArtistNameMap(): Map<string, string> {
  const rows = getDb().prepare('SELECT artist_id, name FROM artists').all() as { artist_id: string; name: string }[];
  return new Map(rows.map((r) => [r.artist_id, r.name]));
}

/**
 * Artists appearing on liked tracks whose name contains `q` (case-insensitive).
 */
export function searchLikedArtists(q: string, limit: number = 20): { artistId: string; name: string; trackCount: number }[] {
  return getDb().prepare(`
    SELECT a.artist_id AS artistId, a.name AS name, COUNT(DISTINCT t.id) AS trackCount
    FROM artists a
    JOIN track_artists ta ON ta.artist_id = a.artist_id
    JOIN tracks t ON t.id = ta.track_id AND t.liked_at IS NOT NULL
    WHERE LOWER(a.name) LIKE ?
    GROUP BY a.artist_id
    ORDER BY trackCount DESC, a.name
    LIMIT ?
  `).all(`%${q.toLowerCase()}%`, limit) as { artistId: string; name: string; trackCount: number }[];
}

export function likedArtistExists(artistId: string): boolean {
  const row = getDb().prepare(`
    SELECT 1 FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
    WHERE ta.artist_id = ? AND t.liked_at IS NOT NULL LIMIT 1
  `).get(artistId);
  return row != null;
}

/** Tracks by internal ID (any order). Uses json_each to avoid variable limits. */
export function getTracksByIds(ids: number[]): TrackRow[] {
  if (ids.length === 0) return [];
  return getDb().prepare(
    'SELECT * FROM tracks WHERE id IN (SELECT value FROM json_each(?))',
  ).all(JSON.stringify(ids)) as unknown as TrackRow[];
}

export function hasRealFeatures(): boolean {
  const row = getDb().prepare(
    "SELECT 1 FROM tracks WHERE liked_at IS NOT NULL AND features_source = 'spotify' LIMIT 1",
  ).get();
  return row != null;
}
```

- [ ] **Step 4: Implement the service**

`server/src/intelligence/genre-playlist.ts`:
```ts
import {
  getLikedTracksWithGenres,
  getArtistNameMap,
  getTracksByIds,
  hasRealFeatures,
  likedArtistExists,
  type LikedTrackGenreRow,
} from '../database/repositories/genre-playlist.repo.js';
import { classifyGenre, familyLabel, OTHER_FAMILY_ID } from './genre-families.js';
import { greedyNearestNeighbor } from './track-ordering.js';

export interface GenrePreviewFilters {
  families: string[];
  includeGenres: string[];
  excludeGenres: string[];
  likedFrom: string | null;
  likedTo: string | null;
  energyMin: number | null;
  energyMax: number | null;
}

export interface PreviewTrack {
  id: number;
  spotifyId: string;
  name: string;
  artist: string;
  albumArtUrl: string | null;
  durationMs: number;
  likedAt: string;
  energy: number | null;
  artistIds: string[];
  matchedGenres: string[];
}

export interface PreviewArtist {
  artistId: string;
  name: string;
  trackCount: number;
}

export interface FamilySummary {
  id: string;
  label: string;
  trackCount: number;
  genres: { name: string; trackCount: number }[];
}

/** Artist genres of the track; the AI-inferred genre only when there are none. */
function trackGenres(row: LikedTrackGenreRow): string[] {
  if (row.genres) return row.genres.split(',');
  if (row.genre_source === 'ai' && row.genre_cluster) return [row.genre_cluster.toLowerCase()];
  return [];
}

function toPreviewTrack(row: LikedTrackGenreRow, matchedGenres: string[]): PreviewTrack {
  return {
    id: row.id,
    spotifyId: row.spotify_id,
    name: row.name,
    artist: row.artist,
    albumArtUrl: row.album_art_url,
    durationMs: row.duration_ms,
    likedAt: row.liked_at,
    energy: row.energy,
    artistIds: row.artist_ids ? row.artist_ids.split(',') : [],
    matchedGenres,
  };
}

export function getGenreSummary(): { families: FamilySummary[]; untaggedCount: number; featuresAvailable: boolean } {
  const familyTracks = new Map<string, Set<number>>();
  const genreTracks = new Map<string, Map<string, number>>(); // family → genre → count
  let untaggedCount = 0;

  for (const row of getLikedTracksWithGenres()) {
    const genres = trackGenres(row);
    if (genres.length === 0) {
      untaggedCount++;
      continue;
    }
    for (const genre of genres) {
      const family = classifyGenre(genre);
      if (!familyTracks.has(family)) familyTracks.set(family, new Set());
      familyTracks.get(family)!.add(row.id);
      if (!genreTracks.has(family)) genreTracks.set(family, new Map());
      const counts = genreTracks.get(family)!;
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }

  const families: FamilySummary[] = [...familyTracks.entries()].map(([id, tracks]) => ({
    id,
    label: familyLabel(id),
    trackCount: tracks.size,
    genres: [...genreTracks.get(id)!.entries()]
      .map(([name, trackCount]) => ({ name, trackCount }))
      .sort((a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name)),
  }));
  families.sort((a, b) => {
    if (a.id === OTHER_FAMILY_ID) return 1;
    if (b.id === OTHER_FAMILY_ID) return -1;
    return b.trackCount - a.trackCount || a.label.localeCompare(b.label);
  });

  return { families, untaggedCount, featuresAvailable: hasRealFeatures() };
}

export function previewGenrePlaylist(f: GenrePreviewFilters): { tracks: PreviewTrack[]; artists: PreviewArtist[] } {
  const familySet = new Set(f.families);
  const includeSet = new Set(f.includeGenres.map((g) => g.toLowerCase()));
  const excludeSet = new Set(f.excludeGenres.map((g) => g.toLowerCase()));
  const useEnergy = (f.energyMin != null || f.energyMax != null) && hasRealFeatures();

  const tracks: PreviewTrack[] = [];
  for (const row of getLikedTracksWithGenres({ likedFrom: f.likedFrom, likedTo: f.likedTo })) {
    const genres = trackGenres(row);
    if (genres.some((g) => excludeSet.has(g))) continue;
    const matched = genres.filter((g) => includeSet.has(g) || familySet.has(classifyGenre(g)));
    if (matched.length === 0) continue;
    if (useEnergy) {
      if (row.energy == null) continue;
      if (f.energyMin != null && row.energy < f.energyMin) continue;
      if (f.energyMax != null && row.energy > f.energyMax) continue;
    }
    tracks.push(toPreviewTrack(row, matched));
  }

  const names = getArtistNameMap();
  const counts = new Map<string, number>();
  for (const t of tracks) {
    for (const a of t.artistIds) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const artists: PreviewArtist[] = [...counts.entries()]
    .map(([artistId, trackCount]) => ({ artistId, name: names.get(artistId) ?? artistId, trackCount }))
    .sort((a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name));

  return { tracks, artists };
}

export function getArtistLikedTracks(artistId: string): PreviewTrack[] | null {
  if (!likedArtistExists(artistId)) return null;
  return getLikedTracksWithGenres({ artistId }).map((row) => toPreviewTrack(row, trackGenres(row)));
}

export function orderTrackIdsSmooth(ids: number[]): number[] {
  const byId = new Map(getTracksByIds(ids).map((t) => [t.id, t]));
  const items = ids.filter((id) => byId.has(id)).map((id) => ({ track: byId.get(id)! }));
  return greedyNearestNeighbor(items).map((i) => i.track.id);
}
```

- [ ] **Step 5: Run the tests**

Run: `cd server && npx vitest run tests/genre-playlist.test.ts`
Expected: 10 tests PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `cd server && npx vitest run && npx tsc --noEmit` — Expected: PASS, exit 0.
```bash
git add server/src/database/repositories/genre-playlist.repo.ts server/src/intelligence/genre-playlist.ts server/tests/genre-playlist.test.ts
git commit -m "feat(genre-playlists): liked-track genre queries and preview service

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: API routes + export

**Files:**
- Modify: `server/src/spotify/player.ts` (`addTracksToPlaylist` gains optional `onProgress`)
- Create: `server/src/api/routes/genre-playlist.routes.ts`
- Modify: `server/src/api/server.ts` (register two plugins)
- Test: `server/tests/genre-playlist.routes.test.ts`

**Interfaces:**
- Consumes: service functions (Task 7); `runArtistGenreSync`, `isGenreSyncRunning`, `getGenreSyncProgress`, `genreSyncEvents` (Task 5); `createSpotifyPlaylist`, `PlaylistPartialError` (Task 1); `insertPlaylistWithTracks` (existing).
- Produces:
  - `addTracksToPlaylist(playlistId: string, uris: string[], onProgress?: (added: number) => void): Promise<number>` — `onProgress` called after each batch.
  - `libraryRoutes` (prefix `/api/library`): `GET /genres`, `POST /genres/sync`, `GET /artists?q=`, `GET /artists/:artistId/liked-tracks`.
  - `genrePlaylistRoutes` (prefix `/api/genre-playlists`): `POST /preview`, `POST /order`, `POST /export`.
  - WebSocket messages: `genre_sync_progress` `{ done, total, running }`; `genre_playlist_export_progress` `{ added, total }`.
  - Response shapes (client relies on these):
    - `GET /genres` → `{ families: FamilySummary[], untaggedCount, featuresAvailable, genreSyncProgress: { done, total, running } }`
    - `POST /preview` → `{ tracks: PreviewTrack[], artists: PreviewArtist[] }`
    - `GET /artists?q=` → `{ artists: { artistId, name, trackCount }[] }`
    - `GET /artists/:artistId/liked-tracks` → `{ tracks: PreviewTrack[] }`
    - `POST /order` → `{ trackIds: number[] }`
    - `POST /export` → `{ id, spotifyPlaylistId, spotifyPlaylistUrl, trackCount, addedCount, partial }`
  - Errors: `400 { error: 'VALIDATION_ERROR', message }`, `404 { error: 'NOT_FOUND' }`, `409 { error: 'SYNC_IN_PROGRESS' | 'EXPORT_IN_PROGRESS' }`, `400 { error: 'FEATURES_UNAVAILABLE' }`, `400 { error: 'UNKNOWN_TRACKS', message }`.

- [ ] **Step 1: Add `onProgress` to `addTracksToPlaylist`**

In `server/src/spotify/player.ts` change the signature and the end of the loop body:
```ts
export async function addTracksToPlaylist(
  playlistId: string,
  uris: string[],
  onProgress?: (added: number) => void,
): Promise<number> {
```
and after `added += batch.length;` add `onProgress?.(added);`.

- [ ] **Step 2: Write the failing route tests**

`server/tests/genre-playlist.routes.test.ts`:
```ts
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd server && npx vitest run tests/genre-playlist.routes.test.ts` — Expected: FAIL (routes module not found).

- [ ] **Step 4: Implement the routes**

`server/src/api/routes/genre-playlist.routes.ts`:
```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getGenreSummary,
  previewGenrePlaylist,
  getArtistLikedTracks,
  orderTrackIdsSmooth,
} from '../../intelligence/genre-playlist.js';
import { searchLikedArtists, getTracksByIds, hasRealFeatures } from '../../database/repositories/genre-playlist.repo.js';
import { insertPlaylistWithTracks } from '../../database/repositories/playlist.repo.js';
import {
  runArtistGenreSync,
  isGenreSyncRunning,
  getGenreSyncProgress,
  genreSyncEvents,
} from '../../spotify/artist-genre-sync.js';
import { createSpotifyPlaylist, addTracksToPlaylist } from '../../spotify/player.js';
import { PlaylistPartialError } from '../../shared/errors.js';
import { broadcast } from '../websocket.js';
import { logger } from '../../shared/logger.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const UNIT = z.number().min(0).max(1);

const previewSchema = z.object({
  families: z.array(z.string()).default([]),
  includeGenres: z.array(z.string()).default([]),
  excludeGenres: z.array(z.string()).default([]),
  likedFrom: DATE.nullable().default(null),
  likedTo: DATE.nullable().default(null),
  energyMin: UNIT.nullable().default(null),
  energyMax: UNIT.nullable().default(null),
}).refine((b) => b.families.length > 0 || b.includeGenres.length > 0, {
  message: 'Select at least one family or genre',
});

const orderSchema = z.object({ trackIds: z.array(z.number().int()).min(1).max(10000) });

const exportSchema = z.object({
  trackIds: z.array(z.number().int()).min(1).max(10000),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(300).default(''),
  isPublic: z.boolean().default(false),
  families: z.array(z.string()).default([]),
});

function parseOr400<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    });
    return null;
  }
  return result.data;
}

let progressWired = false;
let exportInProgress = false;

/** Prefix: /api/library */
export async function libraryRoutes(fastify: FastifyInstance): Promise<void> {
  if (!progressWired) {
    genreSyncEvents.on('progress', (data) => broadcast({ type: 'genre_sync_progress', data }));
    progressWired = true;
  }

  fastify.get('/genres', async () => ({
    ...getGenreSummary(),
    genreSyncProgress: getGenreSyncProgress(),
  }));

  fastify.post('/genres/sync', async (_request, reply) => {
    if (isGenreSyncRunning()) {
      return reply.status(409).send({ error: 'SYNC_IN_PROGRESS', message: 'Genre sync already running' });
    }
    runArtistGenreSync().catch((err) => logger.error({ err }, 'Manual genre sync failed'));
    return reply.status(202).send({ started: true });
  });

  fastify.get('/artists', async (request) => {
    const q = String((request.query as Record<string, string>).q ?? '').trim();
    return { artists: q.length === 0 ? [] : searchLikedArtists(q, 20) };
  });

  fastify.get('/artists/:artistId/liked-tracks', async (request, reply) => {
    const { artistId } = request.params as { artistId: string };
    const tracks = getArtistLikedTracks(artistId);
    if (!tracks) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Artist has no liked tracks' });
    return { tracks };
  });
}

/** Prefix: /api/genre-playlists */
export async function genrePlaylistRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/preview', async (request, reply) => {
    const filters = parseOr400(previewSchema, request.body, reply);
    if (!filters) return reply;
    return previewGenrePlaylist(filters);
  });

  fastify.post('/order', async (request, reply) => {
    const body = parseOr400(orderSchema, request.body, reply);
    if (!body) return reply;
    if (!hasRealFeatures()) {
      return reply.status(400).send({ error: 'FEATURES_UNAVAILABLE', message: 'Audio features are not available' });
    }
    return { trackIds: orderTrackIdsSmooth(body.trackIds) };
  });

  fastify.post('/export', async (request, reply) => {
    const body = parseOr400(exportSchema, request.body, reply);
    if (!body) return reply;
    if (exportInProgress) {
      return reply.status(409).send({ error: 'EXPORT_IN_PROGRESS', message: 'An export is already running' });
    }

    const byId = new Map(getTracksByIds(body.trackIds).map((t) => [t.id, t]));
    const missing = body.trackIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return reply.status(400).send({ error: 'UNKNOWN_TRACKS', message: `Unknown track ids: ${missing.slice(0, 10).join(', ')}` });
    }
    const ordered = body.trackIds.map((id) => byId.get(id)!);
    const uris = ordered.map((t) => `spotify:track:${t.spotify_id}`);

    exportInProgress = true;
    const start = Date.now();
    try {
      const { id: spotifyPlaylistId, url: spotifyPlaylistUrl } =
        await createSpotifyPlaylist(body.name, body.description, body.isPublic);

      let addedCount: number;
      let partial = false;
      try {
        addedCount = await addTracksToPlaylist(spotifyPlaylistId, uris, (added) =>
          broadcast({ type: 'genre_playlist_export_progress', data: { added, total: uris.length } }),
        );
      } catch (err) {
        if (!(err instanceof PlaylistPartialError)) throw err;
        logger.warn({ err, spotifyPlaylistId }, 'Genre playlist export partially failed');
        addedCount = err.addedCount;
        partial = true;
      }

      const kept = ordered.slice(0, addedCount);
      const totalDurationMs = kept.reduce((sum, t) => sum + t.duration_ms, 0);
      const id = insertPlaylistWithTracks(
        {
          prompt: `genre:${body.families.join(',')}`,
          name: body.name,
          description: body.description,
          durationMinutes: Math.round(totalDurationMs / 60000),
          discoveryRate: 0,
          energyArc: 'steady',
          transitionSmoothness: 0,
          maxPerArtist: 0,
          seedTrackId: null,
          sourcePreference: 'library',
          spotifyPlaylistId,
          spotifyPlaylistUrl,
          trackCount: kept.length,
          totalDurationMs,
          generationTimeMs: Date.now() - start,
          aiEnhanced: false,
        },
        kept.map((t, i) => ({ trackId: t.id, position: i + 1, score: null, segment: null })),
      );

      return { id, spotifyPlaylistId, spotifyPlaylistUrl, trackCount: kept.length, addedCount, partial };
    } finally {
      exportInProgress = false;
    }
  });
}
```
Errors from `createSpotifyPlaylist` (e.g. `SpotifyAuthError` 401, `SpotifyApiError`) propagate to the global `errorHandler`, which already maps `OrpheusError` to its status code.

- [ ] **Step 5: Register in `server.ts`**

In `server/src/api/server.ts` add the import
`import { libraryRoutes, genrePlaylistRoutes } from './routes/genre-playlist.routes.js';`
and after the `ttsRoutes` registration:
```ts
  await server.register(libraryRoutes, { prefix: '/api/library' });
  await server.register(genrePlaylistRoutes, { prefix: '/api/genre-playlists' });
```

- [ ] **Step 6: Run all tests + typecheck**

Run: `cd server && npx vitest run && npx tsc --noEmit`
Expected: all PASS; tsc exit 0. If Zod 4's `z.ZodType<T>` generic in `parseOr400` fails to infer the defaulted output type, change the parameter to `schema: z.ZodType<T, any>` — do not loosen to `any`.

- [ ] **Step 7: Smoke-test against a real server (manual, optional if not authenticated)**

Run: `cd server && npm run dev`, then in another shell:
```bash
curl -s http://127.0.0.1:3000/api/library/genres | head -c 600
```
Expected: JSON with `families`, `untaggedCount`, `featuresAvailable`, `genreSyncProgress`.

- [ ] **Step 8: Commit**

```bash
git add server/src/spotify/player.ts server/src/api/routes/genre-playlist.routes.ts server/src/api/server.ts server/tests/genre-playlist.routes.test.ts
git commit -m "feat(api): genre library, preview, order and export routes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Client models, API methods and `GenreBuilderNotifier`

All customization logic lives in a **pure function** (`deriveTracks`) so it can be unit-tested without Riverpod, Dio or widgets.

**Files:**
- Create: `client/lib/models/genre_builder_models.dart`, `client/lib/providers/genre_builder_provider.dart`
- Modify: `client/lib/services/api_service.dart` (append methods before the closing `}` of `ApiService`)
- Test: `client/test/genre_builder_models_test.dart`, `client/test/genre_builder_derive_test.dart`

**Interfaces:**
- Consumes: server response shapes from Task 8.
- Produces (`genre_builder_models.dart`):
  - `GenreCount { String name; int trackCount }`, `GenreFamily { String id; String label; int trackCount; List<GenreCount> genres }`
  - `GenreSyncProgress { int done; int total; bool running; bool get complete }`
  - `GenreLibrary { List<GenreFamily> families; int untaggedCount; bool featuresAvailable; GenreSyncProgress syncProgress }`
  - `PreviewTrack { int id; String spotifyId; String name; String artist; String? albumArtUrl; int durationMs; DateTime? likedAt; double? energy; List<String> artistIds; List<String> matchedGenres }`
  - `PreviewArtist { String artistId; String name; int trackCount }`
  - All have `factory X.fromJson(Map<String, dynamic>)`.
  - `enum TrackSort { likedDesc, likedAsc, artist, title, shuffle, smooth }`
  - `DerivedTracks { List<PreviewTrack> candidates; List<PreviewTrack> selected; int selectedDurationMs }`
  - `DerivedTracks deriveTracks({required List<PreviewTrack> previewTracks, required Map<String, List<PreviewTrack>> forcedArtistTracks, required Set<String> excludedArtistIds, required Set<int> uncheckedIds, required TrackSort sort, List<int>? smoothOrder, int shuffleSeed = 0, int? limit})`
  - `String formatApiDate(DateTime d)` → `YYYY-MM-DD`.
- Produces (`api_service.dart`): `getLibraryGenres()`, `triggerGenreSync()`, `previewGenrePlaylist(Map)`, `searchLibraryArtists(String)`, `getArtistLikedTracks(String)`, `orderTracksSmooth(List<int>)`, `exportGenrePlaylist(Map)`.
- Produces (`genre_builder_provider.dart`): `genreBuilderProvider` (`NotifierProvider<GenreBuilderNotifier, GenreBuilderState>`), `enum ExportStatus { idle, exporting, done, error }`, and the notifier methods listed in Step 7.

Derivation rules (spec §3):
1. `candidates` = preview tracks ∪ forced-artist tracks (dedup by `id`, preview first) − tracks with **any** artist in `excludedArtistIds` (a forced artist is never excluded — the notifier removes it from the excluded set), then sorted.
2. `selected` = `candidates` − `uncheckedIds`, then truncated to `limit` when set.
3. Sorts: `likedDesc`/`likedAsc` by `likedAt` (nulls last); `artist` = artist then title, case-insensitive; `title` = title case-insensitive; `shuffle` = `Random(shuffleSeed)` Fisher–Yates on the date-desc list; `smooth` = order of `smoothOrder`, ids missing from it keep date-desc order at the end.

- [ ] **Step 1: Write the failing model tests**

`client/test/genre_builder_models_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:orpheus/models/genre_builder_models.dart';

void main() {
  test('GenreLibrary.fromJson parses families and sync progress', () {
    final lib = GenreLibrary.fromJson({
      'families': [
        {
          'id': 'k-pop', 'label': 'K-pop', 'trackCount': 842,
          'genres': [{'name': 'k-pop girl group', 'trackCount': 410}],
        },
      ],
      'untaggedCount': 312,
      'featuresAvailable': false,
      'genreSyncProgress': {'done': 1830, 'total': 2140, 'running': true},
    });

    expect(lib.families.single.label, 'K-pop');
    expect(lib.families.single.genres.single.trackCount, 410);
    expect(lib.untaggedCount, 312);
    expect(lib.featuresAvailable, isFalse);
    expect(lib.syncProgress.running, isTrue);
    expect(lib.syncProgress.complete, isFalse);
  });

  test('PreviewTrack.fromJson tolerates nulls', () {
    final t = PreviewTrack.fromJson({
      'id': 1, 'spotifyId': 's1', 'name': 'Supernova', 'artist': 'aespa',
      'albumArtUrl': null, 'durationMs': 180000, 'likedAt': '2024-05-01T10:00:00Z',
      'energy': null, 'artistIds': ['a1'], 'matchedGenres': ['k-pop'],
    });
    expect(t.likedAt, DateTime.utc(2024, 5, 1, 10));
    expect(t.energy, isNull);
    expect(t.artistIds, ['a1']);
  });

  test('formatApiDate', () {
    expect(formatApiDate(DateTime(2023, 1, 5)), '2023-01-05');
  });
}
```

- [ ] **Step 2: Write the failing derivation tests**

`client/test/genre_builder_derive_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:orpheus/models/genre_builder_models.dart';

PreviewTrack t(int id, {String artist = 'A', List<String> artistIds = const ['a'], String? liked, String? name}) =>
    PreviewTrack(
      id: id, spotifyId: 's$id', name: name ?? 'Song $id', artist: artist, albumArtUrl: null,
      durationMs: 1000, likedAt: liked == null ? null : DateTime.parse(liked), energy: null,
      artistIds: artistIds, matchedGenres: const [],
    );

DerivedTracks derive(List<PreviewTrack> preview, {
  Map<String, List<PreviewTrack>> forced = const {},
  Set<String> excluded = const {},
  Set<int> unchecked = const {},
  TrackSort sort = TrackSort.likedDesc,
  List<int>? smooth,
  int? limit,
}) =>
    deriveTracks(
      previewTracks: preview, forcedArtistTracks: forced, excludedArtistIds: excluded,
      uncheckedIds: unchecked, sort: sort, smoothOrder: smooth, limit: limit,
    );

void main() {
  final a = t(1, liked: '2024-01-01', name: 'b-side');
  final b = t(2, liked: '2024-03-01', artist: 'Zed', artistIds: ['z'], name: 'Alpha');
  final c = t(3, liked: '2024-02-01', artistIds: ['a', 'feat'], name: 'Charlie');

  test('sorts by liked date descending by default', () {
    expect(derive([a, b, c]).candidates.map((x) => x.id), [2, 3, 1]);
  });

  test('excluding an artist removes tracks where it appears anywhere', () {
    expect(derive([a, b, c], excluded: {'feat'}).candidates.map((x) => x.id), [2, 1]);
  });

  test('unchecked tracks stay in candidates but leave selected', () {
    final d = derive([a, b, c], unchecked: {3});
    expect(d.candidates.length, 3);
    expect(d.selected.map((x) => x.id), [2, 1]);
    expect(d.selectedDurationMs, 2000);
  });

  test('forced artist tracks are merged without duplicates', () {
    final extra = t(9, liked: '2025-01-01', artistIds: ['x']);
    final d = derive([a, b], forced: {'x': [extra, a]});
    expect(d.candidates.map((x) => x.id), [9, 2, 1]);
  });

  test('limit applies after unchecking', () {
    expect(derive([a, b, c], unchecked: {2}, limit: 1).selected.map((x) => x.id), [3]);
  });

  test('artist and title sorts are case-insensitive', () {
    expect(derive([a, b, c], sort: TrackSort.title).candidates.map((x) => x.id), [2, 1, 3]);
    expect(derive([a, b, c], sort: TrackSort.artist).candidates.map((x) => x.id), [1, 3, 2]);
  });

  test('smooth order follows server ids, unknown ids at the end', () {
    expect(derive([a, b, c], sort: TrackSort.smooth, smooth: [1, 2]).candidates.map((x) => x.id), [1, 2, 3]);
  });

  test('shuffle is deterministic for a seed', () {
    final list = List.generate(20, (i) => t(i, liked: '2024-01-${(i % 28 + 1).toString().padLeft(2, '0')}'));
    final one = deriveTracks(previewTracks: list, forcedArtistTracks: const {}, excludedArtistIds: const {},
        uncheckedIds: const {}, sort: TrackSort.shuffle, shuffleSeed: 7);
    final two = deriveTracks(previewTracks: list, forcedArtistTracks: const {}, excludedArtistIds: const {},
        uncheckedIds: const {}, sort: TrackSort.shuffle, shuffleSeed: 7);
    expect(one.candidates.map((x) => x.id), two.candidates.map((x) => x.id));
    expect(one.candidates.length, 20);
  });
}
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd client && /Users/matella/Coding/SDK/flutter/bin/flutter test test/genre_builder_models_test.dart test/genre_builder_derive_test.dart`
Expected: FAIL — `package:orpheus/models/genre_builder_models.dart` not found.

- [ ] **Step 4: Implement the models**

`client/lib/models/genre_builder_models.dart`:
```dart
import 'dart:math';

class GenreCount {
  final String name;
  final int trackCount;
  const GenreCount({required this.name, required this.trackCount});

  factory GenreCount.fromJson(Map<String, dynamic> json) => GenreCount(
        name: json['name'] as String,
        trackCount: (json['trackCount'] as num).toInt(),
      );
}

class GenreFamily {
  final String id;
  final String label;
  final int trackCount;
  final List<GenreCount> genres;
  const GenreFamily({required this.id, required this.label, required this.trackCount, required this.genres});

  factory GenreFamily.fromJson(Map<String, dynamic> json) => GenreFamily(
        id: json['id'] as String,
        label: json['label'] as String,
        trackCount: (json['trackCount'] as num).toInt(),
        genres: (json['genres'] as List? ?? [])
            .map((g) => GenreCount.fromJson(g as Map<String, dynamic>))
            .toList(),
      );
}

class GenreSyncProgress {
  final int done;
  final int total;
  final bool running;
  const GenreSyncProgress({this.done = 0, this.total = 0, this.running = false});

  bool get complete => total == 0 || done >= total;

  factory GenreSyncProgress.fromJson(Map<String, dynamic> json) => GenreSyncProgress(
        done: (json['done'] as num?)?.toInt() ?? 0,
        total: (json['total'] as num?)?.toInt() ?? 0,
        running: json['running'] as bool? ?? false,
      );
}

class GenreLibrary {
  final List<GenreFamily> families;
  final int untaggedCount;
  final bool featuresAvailable;
  final GenreSyncProgress syncProgress;
  const GenreLibrary({
    required this.families,
    required this.untaggedCount,
    required this.featuresAvailable,
    required this.syncProgress,
  });

  GenreLibrary copyWith({GenreSyncProgress? syncProgress}) => GenreLibrary(
        families: families,
        untaggedCount: untaggedCount,
        featuresAvailable: featuresAvailable,
        syncProgress: syncProgress ?? this.syncProgress,
      );

  factory GenreLibrary.fromJson(Map<String, dynamic> json) => GenreLibrary(
        families: (json['families'] as List? ?? [])
            .map((f) => GenreFamily.fromJson(f as Map<String, dynamic>))
            .toList(),
        untaggedCount: (json['untaggedCount'] as num?)?.toInt() ?? 0,
        featuresAvailable: json['featuresAvailable'] as bool? ?? false,
        syncProgress: GenreSyncProgress.fromJson(
          json['genreSyncProgress'] as Map<String, dynamic>? ?? const {},
        ),
      );
}

class PreviewTrack {
  final int id;
  final String spotifyId;
  final String name;
  final String artist;
  final String? albumArtUrl;
  final int durationMs;
  final DateTime? likedAt;
  final double? energy;
  final List<String> artistIds;
  final List<String> matchedGenres;
  const PreviewTrack({
    required this.id,
    required this.spotifyId,
    required this.name,
    required this.artist,
    required this.albumArtUrl,
    required this.durationMs,
    required this.likedAt,
    required this.energy,
    required this.artistIds,
    required this.matchedGenres,
  });

  factory PreviewTrack.fromJson(Map<String, dynamic> json) => PreviewTrack(
        id: (json['id'] as num).toInt(),
        spotifyId: json['spotifyId'] as String,
        name: json['name'] as String? ?? '',
        artist: json['artist'] as String? ?? '',
        albumArtUrl: json['albumArtUrl'] as String?,
        durationMs: (json['durationMs'] as num?)?.toInt() ?? 0,
        likedAt: json['likedAt'] == null ? null : DateTime.tryParse(json['likedAt'] as String),
        energy: (json['energy'] as num?)?.toDouble(),
        artistIds: (json['artistIds'] as List? ?? []).cast<String>(),
        matchedGenres: (json['matchedGenres'] as List? ?? []).cast<String>(),
      );
}

class PreviewArtist {
  final String artistId;
  final String name;
  final int trackCount;
  const PreviewArtist({required this.artistId, required this.name, required this.trackCount});

  factory PreviewArtist.fromJson(Map<String, dynamic> json) => PreviewArtist(
        artistId: json['artistId'] as String,
        name: json['name'] as String? ?? '',
        trackCount: (json['trackCount'] as num?)?.toInt() ?? 0,
      );
}

enum TrackSort { likedDesc, likedAsc, artist, title, shuffle, smooth }

class DerivedTracks {
  final List<PreviewTrack> candidates;
  final List<PreviewTrack> selected;
  const DerivedTracks({required this.candidates, required this.selected});

  int get selectedDurationMs => selected.fold(0, (sum, t) => sum + t.durationMs);
}

int _compareLikedDesc(PreviewTrack a, PreviewTrack b) {
  if (a.likedAt == null && b.likedAt == null) return 0;
  if (a.likedAt == null) return 1;
  if (b.likedAt == null) return -1;
  return b.likedAt!.compareTo(a.likedAt!);
}

int _compareLikedAsc(PreviewTrack a, PreviewTrack b) {
  if (a.likedAt == null && b.likedAt == null) return 0;
  if (a.likedAt == null) return 1;
  if (b.likedAt == null) return -1;
  return a.likedAt!.compareTo(b.likedAt!);
}

/// Applies the builder's local customization to the server preview.
/// Pure function — see Task 9 derivation rules.
DerivedTracks deriveTracks({
  required List<PreviewTrack> previewTracks,
  required Map<String, List<PreviewTrack>> forcedArtistTracks,
  required Set<String> excludedArtistIds,
  required Set<int> uncheckedIds,
  required TrackSort sort,
  List<int>? smoothOrder,
  int shuffleSeed = 0,
  int? limit,
}) {
  final seen = <int>{};
  final merged = <PreviewTrack>[];
  for (final t in [...previewTracks, ...forcedArtistTracks.values.expand((l) => l)]) {
    if (seen.add(t.id)) merged.add(t);
  }

  final candidates = merged
      .where((t) => !t.artistIds.any(excludedArtistIds.contains))
      .toList()
    ..sort(_compareLikedDesc);

  switch (sort) {
    case TrackSort.likedDesc:
      break;
    case TrackSort.likedAsc:
      candidates.sort(_compareLikedAsc);
    case TrackSort.artist:
      candidates.sort((a, b) {
        final byArtist = a.artist.toLowerCase().compareTo(b.artist.toLowerCase());
        return byArtist != 0 ? byArtist : a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });
    case TrackSort.title:
      candidates.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    case TrackSort.shuffle:
      candidates.shuffle(Random(shuffleSeed));
    case TrackSort.smooth:
      final rank = {for (final (i, id) in (smoothOrder ?? const <int>[]).indexed) id: i};
      final ranked = candidates.where((t) => rank.containsKey(t.id)).toList()
        ..sort((a, b) => rank[a.id]!.compareTo(rank[b.id]!));
      final rest = candidates.where((t) => !rank.containsKey(t.id)).toList();
      candidates
        ..clear()
        ..addAll(ranked)
        ..addAll(rest);
  }

  var selected = candidates.where((t) => !uncheckedIds.contains(t.id)).toList();
  if (limit != null && limit >= 0 && selected.length > limit) {
    selected = selected.sublist(0, limit);
  }
  return DerivedTracks(candidates: candidates, selected: selected);
}

String formatApiDate(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
```
(`candidates.shuffle(Random(seed))` is a Fisher–Yates shuffle — deterministic for a given seed.)

- [ ] **Step 5: Run the tests**

Run: `cd client && /Users/matella/Coding/SDK/flutter/bin/flutter test test/genre_builder_models_test.dart test/genre_builder_derive_test.dart`
Expected: all PASS (3 + 8).

- [ ] **Step 6: Add the API methods**

Append inside `class ApiService` in `client/lib/services/api_service.dart` (before its closing `}`):
```dart
  // ── Genre playlists ─────────────────────────────────────────

  /// Genre families + counts over Liked Songs, and genre-sync progress.
  Future<Map<String, dynamic>> getLibraryGenres() async {
    final response = await _dio.get('/library/genres');
    return response.data as Map<String, dynamic>;
  }

  /// Start the artist-genre sync. A 409 (already running) is not an error.
  Future<void> triggerGenreSync() async {
    try {
      await _dio.post('/library/genres/sync');
    } on DioException catch (e) {
      if (e.response?.statusCode != 409) rethrow;
    }
  }

  /// Every liked track matching the filters (no cap) + artists with counts.
  Future<Map<String, dynamic>> previewGenrePlaylist(Map<String, dynamic> filters) async {
    final response = await _dio.post(
      '/genre-playlists/preview',
      data: filters,
      options: Options(receiveTimeout: const Duration(seconds: 30)),
    );
    return response.data as Map<String, dynamic>;
  }

  /// Artists on liked tracks whose name contains [query].
  Future<List<dynamic>> searchLibraryArtists(String query) async {
    final response = await _dio.get('/library/artists', queryParameters: {'q': query});
    return response.data['artists'] as List? ?? [];
  }

  /// All liked tracks of one artist, regardless of genre.
  Future<List<dynamic>> getArtistLikedTracks(String artistId) async {
    final response = await _dio.get('/library/artists/${Uri.encodeComponent(artistId)}/liked-tracks');
    return response.data['tracks'] as List? ?? [];
  }

  /// Track ids ordered for smooth transitions (requires real audio features).
  Future<List<int>> orderTracksSmooth(List<int> trackIds) async {
    final response = await _dio.post('/genre-playlists/order', data: {'trackIds': trackIds});
    return (response.data['trackIds'] as List).map((e) => (e as num).toInt()).toList();
  }

  /// Create the Spotify playlist from the final ordered track ids.
  Future<Map<String, dynamic>> exportGenrePlaylist(Map<String, dynamic> body) async {
    final response = await _dio.post(
      '/genre-playlists/export',
      data: body,
      options: Options(receiveTimeout: const Duration(minutes: 5)),
    );
    return response.data as Map<String, dynamic>;
  }
```

- [ ] **Step 7: Implement the provider**

`client/lib/providers/genre_builder_provider.dart`:
```dart
import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/genre_builder_models.dart';
import '../services/api_service.dart';
import '../services/websocket_service.dart';

enum ExportStatus { idle, exporting, done, error }

const _unset = Object();

class GenreBuilderState {
  final bool loadingLibrary;
  final GenreLibrary? library;
  final String? libraryError;

  // Server-side filters (trigger a debounced preview)
  final Set<String> families;
  final Set<String> excludedGenres;
  final DateTime? likedFrom;
  final DateTime? likedTo;
  final double? energyMin;
  final double? energyMax;

  final bool loadingPreview;
  final String? previewError;
  final List<PreviewTrack> previewTracks;
  final List<PreviewArtist> previewArtists;

  // Local customization (no network)
  final Map<String, List<PreviewTrack>> forcedArtistTracks;
  final Map<String, String> forcedArtistNames;
  final Set<String> excludedArtistIds;
  final Set<int> uncheckedIds;
  final TrackSort sort;
  final List<int>? smoothOrder;
  final int shuffleSeed;
  final int? limit;

  final ExportStatus exportStatus;
  final int exportAdded;
  final int exportTotal;
  final Map<String, dynamic>? exportResult;
  final String? exportError;

  const GenreBuilderState({
    this.loadingLibrary = false,
    this.library,
    this.libraryError,
    this.families = const {},
    this.excludedGenres = const {},
    this.likedFrom,
    this.likedTo,
    this.energyMin,
    this.energyMax,
    this.loadingPreview = false,
    this.previewError,
    this.previewTracks = const [],
    this.previewArtists = const [],
    this.forcedArtistTracks = const {},
    this.forcedArtistNames = const {},
    this.excludedArtistIds = const {},
    this.uncheckedIds = const {},
    this.sort = TrackSort.likedDesc,
    this.smoothOrder,
    this.shuffleSeed = 0,
    this.limit,
    this.exportStatus = ExportStatus.idle,
    this.exportAdded = 0,
    this.exportTotal = 0,
    this.exportResult,
    this.exportError,
  });

  DerivedTracks get derived => deriveTracks(
        previewTracks: previewTracks,
        forcedArtistTracks: forcedArtistTracks,
        excludedArtistIds: excludedArtistIds,
        uncheckedIds: uncheckedIds,
        sort: sort,
        smoothOrder: smoothOrder,
        shuffleSeed: shuffleSeed,
        limit: limit,
      );

  bool get hasSelection => families.isNotEmpty;

  /// Default export name: "<first family label> — Orpheus".
  String get defaultPlaylistName {
    final labels = library?.families
            .where((f) => families.contains(f.id))
            .map((f) => f.label)
            .toList() ??
        const <String>[];
    return labels.isEmpty ? 'Orpheus Mix' : '${labels.join(' + ')} — Orpheus';
  }

  GenreBuilderState copyWith({
    bool? loadingLibrary,
    Object? library = _unset,
    Object? libraryError = _unset,
    Set<String>? families,
    Set<String>? excludedGenres,
    Object? likedFrom = _unset,
    Object? likedTo = _unset,
    Object? energyMin = _unset,
    Object? energyMax = _unset,
    bool? loadingPreview,
    Object? previewError = _unset,
    List<PreviewTrack>? previewTracks,
    List<PreviewArtist>? previewArtists,
    Map<String, List<PreviewTrack>>? forcedArtistTracks,
    Map<String, String>? forcedArtistNames,
    Set<String>? excludedArtistIds,
    Set<int>? uncheckedIds,
    TrackSort? sort,
    Object? smoothOrder = _unset,
    int? shuffleSeed,
    Object? limit = _unset,
    ExportStatus? exportStatus,
    int? exportAdded,
    int? exportTotal,
    Object? exportResult = _unset,
    Object? exportError = _unset,
  }) {
    return GenreBuilderState(
      loadingLibrary: loadingLibrary ?? this.loadingLibrary,
      library: identical(library, _unset) ? this.library : library as GenreLibrary?,
      libraryError: identical(libraryError, _unset) ? this.libraryError : libraryError as String?,
      families: families ?? this.families,
      excludedGenres: excludedGenres ?? this.excludedGenres,
      likedFrom: identical(likedFrom, _unset) ? this.likedFrom : likedFrom as DateTime?,
      likedTo: identical(likedTo, _unset) ? this.likedTo : likedTo as DateTime?,
      energyMin: identical(energyMin, _unset) ? this.energyMin : energyMin as double?,
      energyMax: identical(energyMax, _unset) ? this.energyMax : energyMax as double?,
      loadingPreview: loadingPreview ?? this.loadingPreview,
      previewError: identical(previewError, _unset) ? this.previewError : previewError as String?,
      previewTracks: previewTracks ?? this.previewTracks,
      previewArtists: previewArtists ?? this.previewArtists,
      forcedArtistTracks: forcedArtistTracks ?? this.forcedArtistTracks,
      forcedArtistNames: forcedArtistNames ?? this.forcedArtistNames,
      excludedArtistIds: excludedArtistIds ?? this.excludedArtistIds,
      uncheckedIds: uncheckedIds ?? this.uncheckedIds,
      sort: sort ?? this.sort,
      smoothOrder: identical(smoothOrder, _unset) ? this.smoothOrder : smoothOrder as List<int>?,
      shuffleSeed: shuffleSeed ?? this.shuffleSeed,
      limit: identical(limit, _unset) ? this.limit : limit as int?,
      exportStatus: exportStatus ?? this.exportStatus,
      exportAdded: exportAdded ?? this.exportAdded,
      exportTotal: exportTotal ?? this.exportTotal,
      exportResult: identical(exportResult, _unset) ? this.exportResult : exportResult as Map<String, dynamic>?,
      exportError: identical(exportError, _unset) ? this.exportError : exportError as String?,
    );
  }
}

class GenreBuilderNotifier extends Notifier<GenreBuilderState> {
  StreamSubscription<Map<String, dynamic>>? _wsSub;
  Timer? _debounce;
  int _previewRequest = 0;

  @override
  GenreBuilderState build() {
    ref.onDispose(() {
      _wsSub?.cancel();
      _debounce?.cancel();
    });
    _listenToWebSocket();
    Future.microtask(loadLibrary);
    return const GenreBuilderState(loadingLibrary: true);
  }

  void _listenToWebSocket() {
    _wsSub?.cancel();
    _wsSub = wsService.messages.listen((msg) {
      final data = msg['data'] as Map<String, dynamic>?;
      if (data == null) return;
      switch (msg['type']) {
        case 'genre_sync_progress':
          final progress = GenreSyncProgress.fromJson(data);
          final lib = state.library;
          if (lib != null) state = state.copyWith(library: lib.copyWith(syncProgress: progress));
          // Refresh counts once a sync run finishes.
          if (!progress.running && lib != null && lib.syncProgress.running) loadLibrary();
        case 'genre_playlist_export_progress':
          if (state.exportStatus == ExportStatus.exporting) {
            state = state.copyWith(
              exportAdded: (data['added'] as num?)?.toInt() ?? 0,
              exportTotal: (data['total'] as num?)?.toInt() ?? state.exportTotal,
            );
          }
      }
    });
  }

  String _errorText(Object e) {
    if (e is DioException) {
      final body = e.response?.data;
      if (body is Map && body['message'] is String) return body['message'] as String;
      return e.message ?? 'Network error';
    }
    return e.toString();
  }

  Future<void> loadLibrary() async {
    state = state.copyWith(loadingLibrary: true, libraryError: null);
    try {
      final json = await apiService.getLibraryGenres();
      state = state.copyWith(loadingLibrary: false, library: GenreLibrary.fromJson(json));
    } catch (e) {
      state = state.copyWith(loadingLibrary: false, libraryError: _errorText(e));
    }
  }

  Future<void> triggerGenreSync() async {
    try {
      await apiService.triggerGenreSync();
    } catch (e) {
      state = state.copyWith(libraryError: _errorText(e));
    }
  }

  // ── Server filters ────────────────────────────────────────

  void toggleFamily(String familyId) {
    final next = {...state.families};
    if (!next.remove(familyId)) next.add(familyId);
    state = state.copyWith(families: next);
    _schedulePreview();
  }

  void toggleSubGenre(String genre) {
    final next = {...state.excludedGenres};
    if (!next.remove(genre)) next.add(genre);
    state = state.copyWith(excludedGenres: next);
    _schedulePreview();
  }

  void setLikedRange(DateTime? from, DateTime? to) {
    state = state.copyWith(likedFrom: from, likedTo: to);
    _schedulePreview();
  }

  void setEnergyRange(double? min, double? max) {
    state = state.copyWith(energyMin: min, energyMax: max);
    _schedulePreview();
  }

  void _schedulePreview() {
    _debounce?.cancel();
    if (state.families.isEmpty) {
      _previewRequest++;
      state = state.copyWith(previewTracks: const [], previewArtists: const [], loadingPreview: false, previewError: null);
      return;
    }
    state = state.copyWith(loadingPreview: true);
    _debounce = Timer(const Duration(milliseconds: 400), _runPreview);
  }

  Future<void> _runPreview() async {
    final request = ++_previewRequest;
    final s = state;
    try {
      final json = await apiService.previewGenrePlaylist({
        'families': s.families.toList(),
        'excludeGenres': s.excludedGenres.toList(),
        'likedFrom': s.likedFrom == null ? null : formatApiDate(s.likedFrom!),
        'likedTo': s.likedTo == null ? null : formatApiDate(s.likedTo!),
        'energyMin': s.energyMin,
        'energyMax': s.energyMax,
      });
      if (request != _previewRequest) return; // stale response
      final tracks = (json['tracks'] as List)
          .map((t) => PreviewTrack.fromJson(t as Map<String, dynamic>))
          .toList();
      final artists = (json['artists'] as List)
          .map((a) => PreviewArtist.fromJson(a as Map<String, dynamic>))
          .toList();
      final stillPresent = tracks.map((t) => t.id).toSet();
      state = state.copyWith(
        loadingPreview: false,
        previewError: null,
        previewTracks: tracks,
        previewArtists: artists,
        uncheckedIds: state.uncheckedIds.where(stillPresent.contains).toSet(),
        smoothOrder: null,
        sort: state.sort == TrackSort.smooth ? TrackSort.likedDesc : state.sort,
      );
    } catch (e) {
      if (request != _previewRequest) return;
      state = state.copyWith(loadingPreview: false, previewError: _errorText(e));
    }
  }

  // ── Local customization ───────────────────────────────────

  void toggleTrack(int trackId) {
    final next = {...state.uncheckedIds};
    if (!next.remove(trackId)) next.add(trackId);
    state = state.copyWith(uncheckedIds: next);
  }

  void setAllChecked(bool checked) {
    state = state.copyWith(
      uncheckedIds: checked ? <int>{} : state.derived.candidates.map((t) => t.id).toSet(),
    );
  }

  void toggleArtistExcluded(String artistId) {
    final next = {...state.excludedArtistIds};
    if (!next.remove(artistId)) next.add(artistId);
    state = state.copyWith(excludedArtistIds: next);
  }

  Future<List<PreviewArtist>> searchArtists(String query) async {
    if (query.trim().isEmpty) return const [];
    final raw = await apiService.searchLibraryArtists(query.trim());
    return raw.map((a) => PreviewArtist.fromJson(a as Map<String, dynamic>)).toList();
  }

  Future<void> forceArtist(PreviewArtist artist) async {
    try {
      final raw = await apiService.getArtistLikedTracks(artist.artistId);
      final tracks = raw.map((t) => PreviewTrack.fromJson(t as Map<String, dynamic>)).toList();
      state = state.copyWith(
        forcedArtistTracks: {...state.forcedArtistTracks, artist.artistId: tracks},
        forcedArtistNames: {...state.forcedArtistNames, artist.artistId: artist.name},
        excludedArtistIds: {...state.excludedArtistIds}..remove(artist.artistId),
      );
    } catch (e) {
      state = state.copyWith(previewError: _errorText(e));
    }
  }

  void removeForcedArtist(String artistId) {
    state = state.copyWith(
      forcedArtistTracks: {...state.forcedArtistTracks}..remove(artistId),
      forcedArtistNames: {...state.forcedArtistNames}..remove(artistId),
    );
  }

  Future<void> setSort(TrackSort sort) async {
    if (sort == TrackSort.shuffle) {
      state = state.copyWith(sort: sort, shuffleSeed: DateTime.now().millisecondsSinceEpoch);
      return;
    }
    if (sort != TrackSort.smooth) {
      state = state.copyWith(sort: sort);
      return;
    }
    final ids = state.derived.candidates.map((t) => t.id).toList();
    if (ids.isEmpty) return;
    try {
      final ordered = await apiService.orderTracksSmooth(ids);
      state = state.copyWith(sort: TrackSort.smooth, smoothOrder: ordered);
    } catch (e) {
      state = state.copyWith(previewError: _errorText(e));
    }
  }

  void setLimit(int? limit) => state = state.copyWith(limit: limit);

  // ── Export ────────────────────────────────────────────────

  Future<void> exportPlaylist({required String name, required String description, required bool isPublic}) async {
    final ids = state.derived.selected.map((t) => t.id).toList();
    if (ids.isEmpty) return;
    state = state.copyWith(
      exportStatus: ExportStatus.exporting,
      exportAdded: 0,
      exportTotal: ids.length,
      exportResult: null,
      exportError: null,
    );
    try {
      final result = await apiService.exportGenrePlaylist({
        'trackIds': ids,
        'name': name,
        'description': description,
        'isPublic': isPublic,
        'families': state.families.toList(),
      });
      state = state.copyWith(exportStatus: ExportStatus.done, exportResult: result);
    } catch (e) {
      state = state.copyWith(exportStatus: ExportStatus.error, exportError: _errorText(e));
    }
  }

  /// Back to an empty builder (keeps the loaded library).
  void startOver() {
    _debounce?.cancel();
    _previewRequest++;
    state = GenreBuilderState(library: state.library);
  }
}

final genreBuilderProvider = NotifierProvider<GenreBuilderNotifier, GenreBuilderState>(
  GenreBuilderNotifier.new,
);
```

- [ ] **Step 8: Analyze + tests**

Run:
```bash
cd client && /Users/matella/Coding/SDK/flutter/bin/flutter analyze && /Users/matella/Coding/SDK/flutter/bin/flutter test
```
Expected: analyze reports exactly the **5 baseline issues** (none in the new files); all tests PASS. Note `switch` statements rely on Dart 3 no-fallthrough semantics (no `break` needed) — valid for SDK `^3.5.0`.

- [ ] **Step 9: Commit**

```bash
git add client/lib/models/genre_builder_models.dart client/lib/providers/genre_builder_provider.dart client/lib/services/api_service.dart client/test/genre_builder_models_test.dart client/test/genre_builder_derive_test.dart
git commit -m "feat(client): genre builder models, API methods and provider

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Client widgets, responsive builder, Playlist screen integration

New widgets take **plain values + callbacks** (no provider access) so they are testable in isolation; only `GenrePlaylistBuilder` reads `genreBuilderProvider`. New widgets use `Theme.of(context).textTheme` and `OrpheusColors` — **no `GoogleFonts`** (it fetches fonts at runtime and breaks widget tests).

**Files:**
- Create: `client/lib/widgets/genre_builder/genre_family_picker.dart`, `artist_filter_panel.dart`, `secondary_filters.dart`, `track_preview_list.dart`, `export_bar.dart`, `genre_playlist_builder.dart` (all in `client/lib/widgets/genre_builder/`)
- Modify: `client/lib/screens/playlist_screen.dart`
- Test: `client/test/genre_family_picker_test.dart`

**Interfaces:**
- Consumes: models + `genreBuilderProvider` + `ExportStatus` (Task 9).
- Produces:
  - `GenreFamilyPicker({required List<GenreFamily> families, required Set<String> selected, required Set<String> excludedGenres, required int untaggedCount, required GenreSyncProgress syncProgress, required ValueChanged<String> onToggleFamily, required ValueChanged<String> onToggleSubGenre, required VoidCallback onContinueSync})`
  - `ArtistFilterPanel({required List<PreviewArtist> artists, required Set<String> excluded, required Map<String, String> forced, required ValueChanged<String> onToggleExcluded, required Future<List<PreviewArtist>> Function(String) onSearch, required ValueChanged<PreviewArtist> onForce, required ValueChanged<String> onRemoveForced})`
  - `SecondaryFilters({DateTime? likedFrom, DateTime? likedTo, int? limit, double? energyMin, double? energyMax, required bool featuresAvailable, required void Function(DateTime?, DateTime?) onLikedRange, required ValueChanged<int?> onLimit, required void Function(double?, double?) onEnergy})`
  - `TrackPreviewList({required List<PreviewTrack> candidates, required Set<int> uncheckedIds, required int selectedCount, required int selectedDurationMs, required TrackSort sort, required bool featuresAvailable, required bool loading, required ValueChanged<int> onToggle, required ValueChanged<bool> onSetAll, required ValueChanged<TrackSort> onSort})`
  - `ExportBar({required int selectedCount, required int selectedDurationMs, required VoidCallback? onCreate})` and `showExportSheet(BuildContext context)` (reads the provider itself).
  - `GenrePlaylistBuilder()` — `ConsumerWidget`, breakpoint `700`.

- [ ] **Step 1: Write the failing widget test**

`client/test/genre_family_picker_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orpheus/models/genre_builder_models.dart';
import 'package:orpheus/widgets/genre_builder/genre_family_picker.dart';

void main() {
  const families = [
    GenreFamily(id: 'k-pop', label: 'K-pop', trackCount: 842, genres: [
      GenreCount(name: 'k-pop girl group', trackCount: 410),
      GenreCount(name: 'k-rap', trackCount: 30),
    ]),
    GenreFamily(id: 'rock', label: 'Rock', trackCount: 610, genres: []),
  ];

  Widget host({
    Set<String> selected = const {},
    Set<String> excluded = const {},
    GenreSyncProgress progress = const GenreSyncProgress(done: 10, total: 10),
    ValueChanged<String>? onFamily,
    ValueChanged<String>? onSub,
    VoidCallback? onSync,
  }) =>
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: GenreFamilyPicker(
              families: families,
              selected: selected,
              excludedGenres: excluded,
              untaggedCount: 312,
              syncProgress: progress,
              onToggleFamily: onFamily ?? (_) {},
              onToggleSubGenre: onSub ?? (_) {},
              onContinueSync: onSync ?? () {},
            ),
          ),
        ),
      );

  testWidgets('shows families with counts and toggles on tap', (tester) async {
    String? tapped;
    await tester.pumpWidget(host(onFamily: (id) => tapped = id));

    expect(find.text('K-pop · 842'), findsOneWidget);
    expect(find.text('312 untagged tracks'), findsOneWidget);
    await tester.tap(find.text('Rock · 610'));
    expect(tapped, 'rock');
  });

  testWidgets('selected family lists sub-genres; unchecking excludes', (tester) async {
    String? sub;
    await tester.pumpWidget(host(selected: {'k-pop'}, excluded: {'k-rap'}, onSub: (g) => sub = g));

    expect(find.text('k-pop girl group · 410'), findsOneWidget);
    final kRap = tester.widget<FilterChip>(find.widgetWithText(FilterChip, 'k-rap · 30'));
    expect(kRap.selected, isFalse);
    await tester.tap(find.text('k-pop girl group · 410'));
    expect(sub, 'k-pop girl group');
  });

  testWidgets('shows sync progress and continue button while incomplete', (tester) async {
    var synced = false;
    await tester.pumpWidget(host(
      progress: const GenreSyncProgress(done: 1830, total: 2140, running: false),
      onSync: () => synced = true,
    ));

    expect(find.text('Genre sync 1830 / 2140'), findsOneWidget);
    await tester.tap(find.text('Continue sync'));
    expect(synced, isTrue);
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && /Users/matella/Coding/SDK/flutter/bin/flutter test test/genre_family_picker_test.dart`
Expected: FAIL — `genre_family_picker.dart` not found.

- [ ] **Step 3: `genre_family_picker.dart`**

```dart
import 'package:flutter/material.dart';
import '../../config/theme.dart';
import '../../models/genre_builder_models.dart';

/// Multi-select genre families; each selected family shows its sub-genres,
/// which can be unchecked (→ excluded from the preview).
class GenreFamilyPicker extends StatelessWidget {
  final List<GenreFamily> families;
  final Set<String> selected;
  final Set<String> excludedGenres;
  final int untaggedCount;
  final GenreSyncProgress syncProgress;
  final ValueChanged<String> onToggleFamily;
  final ValueChanged<String> onToggleSubGenre;
  final VoidCallback onContinueSync;

  const GenreFamilyPicker({
    super.key,
    required this.families,
    required this.selected,
    required this.excludedGenres,
    required this.untaggedCount,
    required this.syncProgress,
    required this.onToggleFamily,
    required this.onToggleSubGenre,
    required this.onContinueSync,
  });

  @override
  Widget build(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall?.copyWith(color: OrpheusColors.mist);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (!syncProgress.complete) ...[
          Text('Genre sync ${syncProgress.done} / ${syncProgress.total}', style: small),
          const SizedBox(height: 4),
          LinearProgressIndicator(
            value: syncProgress.total == 0 ? null : syncProgress.done / syncProgress.total,
            color: OrpheusColors.lyreGold,
            backgroundColor: OrpheusColors.slate,
          ),
          if (!syncProgress.running)
            TextButton(onPressed: onContinueSync, child: const Text('Continue sync')),
          const SizedBox(height: 8),
        ],
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final f in families)
              FilterChip(
                label: Text('${f.label} · ${f.trackCount}'),
                selected: selected.contains(f.id),
                onSelected: (_) => onToggleFamily(f.id),
                selectedColor: OrpheusColors.deepGold,
                side: BorderSide(color: selected.contains(f.id) ? OrpheusColors.lyreGold : OrpheusColors.slate),
              ),
          ],
        ),
        for (final f in families.where((f) => selected.contains(f.id) && f.genres.length > 1)) ...[
          const SizedBox(height: 12),
          Text('${f.label} sub-genres', style: small),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final g in f.genres)
                FilterChip(
                  label: Text('${g.name} · ${g.trackCount}'),
                  selected: !excludedGenres.contains(g.name),
                  onSelected: (_) => onToggleSubGenre(g.name),
                  visualDensity: VisualDensity.compact,
                ),
            ],
          ),
        ],
        if (untaggedCount > 0) ...[
          const SizedBox(height: 8),
          Text('$untaggedCount untagged tracks', style: small),
        ],
      ],
    );
  }
}
```

- [ ] **Step 4: Run the widget test**

Run: `cd client && /Users/matella/Coding/SDK/flutter/bin/flutter test test/genre_family_picker_test.dart`
Expected: 3 tests PASS.

- [ ] **Step 5: `artist_filter_panel.dart`**

```dart
import 'package:flutter/material.dart';
import '../../config/theme.dart';
import '../../models/genre_builder_models.dart';

/// Result artists with exclusion checkboxes + search to force-include an artist.
class ArtistFilterPanel extends StatefulWidget {
  final List<PreviewArtist> artists;
  final Set<String> excluded;
  final Map<String, String> forced;
  final ValueChanged<String> onToggleExcluded;
  final Future<List<PreviewArtist>> Function(String query) onSearch;
  final ValueChanged<PreviewArtist> onForce;
  final ValueChanged<String> onRemoveForced;

  const ArtistFilterPanel({
    super.key,
    required this.artists,
    required this.excluded,
    required this.forced,
    required this.onToggleExcluded,
    required this.onSearch,
    required this.onForce,
    required this.onRemoveForced,
  });

  @override
  State<ArtistFilterPanel> createState() => _ArtistFilterPanelState();
}

class _ArtistFilterPanelState extends State<ArtistFilterPanel> {
  static const _collapsedCount = 12;
  bool _showAll = false;

  @override
  Widget build(BuildContext context) {
    final visible = _showAll ? widget.artists : widget.artists.take(_collapsedCount).toList();
    final small = Theme.of(context).textTheme.bodySmall;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Autocomplete<PreviewArtist>(
          displayStringForOption: (a) => a.name,
          optionsBuilder: (value) => widget.onSearch(value.text),
          onSelected: widget.onForce,
          fieldViewBuilder: (context, controller, focusNode, onSubmit) => TextField(
            controller: controller,
            focusNode: focusNode,
            decoration: const InputDecoration(
              isDense: true,
              prefixIcon: Icon(Icons.push_pin_outlined, size: 18),
              hintText: 'Force-add an artist…',
            ),
          ),
        ),
        if (widget.forced.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            children: [
              for (final e in widget.forced.entries)
                InputChip(
                  avatar: const Icon(Icons.push_pin, size: 14, color: OrpheusColors.lyreGold),
                  label: Text(e.value),
                  onDeleted: () => widget.onRemoveForced(e.key),
                ),
            ],
          ),
        ],
        const SizedBox(height: 8),
        for (final a in visible)
          CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: !widget.excluded.contains(a.artistId),
            onChanged: (_) => widget.onToggleExcluded(a.artistId),
            title: Text(a.name, maxLines: 1, overflow: TextOverflow.ellipsis),
            secondary: Text('${a.trackCount}', style: small?.copyWith(color: OrpheusColors.mist)),
          ),
        if (widget.artists.length > _collapsedCount)
          TextButton(
            onPressed: () => setState(() => _showAll = !_showAll),
            child: Text(_showAll ? 'Show fewer' : 'Show all ${widget.artists.length} artists'),
          ),
      ],
    );
  }
}
```

- [ ] **Step 6: `secondary_filters.dart`**

```dart
import 'package:flutter/material.dart';
import '../../config/theme.dart';
import '../../models/genre_builder_models.dart';

/// Liked-date range, track limit, and energy range (only with real features).
class SecondaryFilters extends StatelessWidget {
  final DateTime? likedFrom;
  final DateTime? likedTo;
  final int? limit;
  final double? energyMin;
  final double? energyMax;
  final bool featuresAvailable;
  final void Function(DateTime? from, DateTime? to) onLikedRange;
  final ValueChanged<int?> onLimit;
  final void Function(double? min, double? max) onEnergy;

  const SecondaryFilters({
    super.key,
    this.likedFrom,
    this.likedTo,
    this.limit,
    this.energyMin,
    this.energyMax,
    required this.featuresAvailable,
    required this.onLikedRange,
    required this.onLimit,
    required this.onEnergy,
  });

  Future<void> _pickRange(BuildContext context) async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2008),
      lastDate: now,
      initialDateRange: likedFrom != null && likedTo != null
          ? DateTimeRange(start: likedFrom!, end: likedTo!)
          : null,
    );
    if (picked != null) onLikedRange(picked.start, picked.end);
  }

  @override
  Widget build(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall?.copyWith(color: OrpheusColors.mist);
    final rangeLabel = likedFrom == null
        ? 'Any time'
        : '${formatApiDate(likedFrom!)} → ${likedTo == null ? 'today' : formatApiDate(likedTo!)}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Liked between', style: small),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => _pickRange(context),
                icon: const Icon(Icons.date_range_rounded, size: 18),
                label: Text(rangeLabel),
              ),
            ),
            if (likedFrom != null)
              IconButton(
                tooltip: 'Clear date range',
                onPressed: () => onLikedRange(null, null),
                icon: const Icon(Icons.close_rounded, size: 18),
              ),
          ],
        ),
        const SizedBox(height: 12),
        Text('Max tracks (empty = all)', style: small),
        TextFormField(
          initialValue: limit?.toString() ?? '',
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(isDense: true, hintText: 'All'),
          onChanged: (v) => onLimit(int.tryParse(v.trim())),
        ),
        if (featuresAvailable) ...[
          const SizedBox(height: 12),
          Text('Energy', style: small),
          RangeSlider(
            values: RangeValues(energyMin ?? 0, energyMax ?? 1),
            divisions: 20,
            labels: RangeLabels(
              ((energyMin ?? 0) * 100).round().toString(),
              ((energyMax ?? 1) * 100).round().toString(),
            ),
            onChanged: (v) => onEnergy(v.start <= 0 ? null : v.start, v.end >= 1 ? null : v.end),
          ),
        ],
      ],
    );
  }
}
```
(`onChanged` of the `RangeSlider` fires on every drag step; the provider debounces previews by 400 ms, so no extra throttle is needed.)

- [ ] **Step 7: `track_preview_list.dart`**

```dart
import 'package:flutter/material.dart';
import '../../config/theme.dart';
import '../../models/genre_builder_models.dart';

String formatDuration(int ms) {
  final minutes = ms ~/ 60000;
  return minutes >= 60 ? '${minutes ~/ 60} h ${(minutes % 60).toString().padLeft(2, '0')}' : '$minutes min';
}

const _sortLabels = {
  TrackSort.likedDesc: 'Liked (newest)',
  TrackSort.likedAsc: 'Liked (oldest)',
  TrackSort.artist: 'Artist',
  TrackSort.title: 'Title',
  TrackSort.shuffle: 'Shuffle',
  TrackSort.smooth: 'Smooth transitions',
};

/// Header (counts, select all, sort) + lazily built checkable track rows.
/// Must be given bounded height (it contains an Expanded ListView).
class TrackPreviewList extends StatelessWidget {
  final List<PreviewTrack> candidates;
  final Set<int> uncheckedIds;
  final int selectedCount;
  final int selectedDurationMs;
  final TrackSort sort;
  final bool featuresAvailable;
  final bool loading;
  final ValueChanged<int> onToggle;
  final ValueChanged<bool> onSetAll;
  final ValueChanged<TrackSort> onSort;

  const TrackPreviewList({
    super.key,
    required this.candidates,
    required this.uncheckedIds,
    required this.selectedCount,
    required this.selectedDurationMs,
    required this.sort,
    required this.featuresAvailable,
    required this.loading,
    required this.onToggle,
    required this.onSetAll,
    required this.onSort,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '$selectedCount / ${candidates.length} selected · ${formatDuration(selectedDurationMs)}',
                style: text.bodySmall?.copyWith(color: OrpheusColors.lyreGold),
              ),
            ),
            IconButton(tooltip: 'Select all', onPressed: () => onSetAll(true), icon: const Icon(Icons.done_all_rounded, size: 20)),
            IconButton(tooltip: 'Unselect all', onPressed: () => onSetAll(false), icon: const Icon(Icons.remove_done_rounded, size: 20)),
            PopupMenuButton<TrackSort>(
              tooltip: 'Sort',
              icon: const Icon(Icons.sort_rounded, size: 20),
              initialValue: sort,
              onSelected: onSort,
              itemBuilder: (_) => [
                for (final s in TrackSort.values)
                  if (s != TrackSort.smooth || featuresAvailable)
                    PopupMenuItem(value: s, child: Text(_sortLabels[s]!)),
              ],
            ),
          ],
        ),
        if (loading) const LinearProgressIndicator(color: OrpheusColors.lyreGold, minHeight: 2),
        Expanded(
          child: candidates.isEmpty
              ? Center(
                  child: Text(
                    loading ? 'Loading…' : 'Pick a genre family to preview tracks',
                    style: text.bodyMedium?.copyWith(color: OrpheusColors.mist),
                  ),
                )
              : ListView.builder(
                  itemCount: candidates.length,
                  itemExtent: 56,
                  itemBuilder: (context, i) {
                    final t = candidates[i];
                    final checked = !uncheckedIds.contains(t.id);
                    return InkWell(
                      onTap: () => onToggle(t.id),
                      child: Row(
                        children: [
                          Checkbox(value: checked, onChanged: (_) => onToggle(t.id)),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: t.albumArtUrl == null
                                ? Container(width: 40, height: 40, color: OrpheusColors.charcoal)
                                : Image.network(
                                    t.albumArtUrl!,
                                    width: 40,
                                    height: 40,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) =>
                                        Container(width: 40, height: 40, color: OrpheusColors.charcoal),
                                  ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Opacity(
                              opacity: checked ? 1 : 0.4,
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(t.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.bodyMedium),
                                  Text(
                                    t.artist,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: text.bodySmall?.copyWith(color: OrpheusColors.mist),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          if (t.likedAt != null)
                            Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: Text(
                                formatApiDate(t.likedAt!.toLocal()),
                                style: text.bodySmall?.copyWith(color: OrpheusColors.mist),
                              ),
                            ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
```

- [ ] **Step 8: `export_bar.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../config/theme.dart';
import '../../providers/genre_builder_provider.dart';
import '../spotify_attribution.dart';
import 'track_preview_list.dart' show formatDuration;

/// Bottom bar with the create button.
class ExportBar extends StatelessWidget {
  final int selectedCount;
  final int selectedDurationMs;
  final VoidCallback? onCreate;

  const ExportBar({super.key, required this.selectedCount, required this.selectedDurationMs, required this.onCreate});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: selectedCount > 0 ? onCreate : null,
            icon: const Icon(Icons.playlist_add_rounded),
            label: Text('Create · $selectedCount tracks · ${formatDuration(selectedDurationMs)}'),
            style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
          ),
        ),
      ),
    );
  }
}

/// Name / description / visibility form, then progress and result.
Future<void> showExportSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: OrpheusColors.onyx,
    builder: (_) => const _ExportSheet(),
  );
}

class _ExportSheet extends ConsumerStatefulWidget {
  const _ExportSheet();

  @override
  ConsumerState<_ExportSheet> createState() => _ExportSheetState();
}

class _ExportSheetState extends ConsumerState<_ExportSheet> {
  late final TextEditingController _name;
  final _description = TextEditingController();
  bool _isPublic = false;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: ref.read(genreBuilderProvider).defaultPlaylistName);
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _open(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(genreBuilderProvider);
    final notifier = ref.read(genreBuilderProvider.notifier);
    final text = Theme.of(context).textTheme;

    final Widget body = switch (state.exportStatus) {
      ExportStatus.idle || ExportStatus.error => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('New Spotify playlist', style: text.titleMedium),
            const SizedBox(height: 12),
            TextField(
              controller: _name,
              maxLength: 100,
              decoration: const InputDecoration(labelText: 'Name'),
              onChanged: (_) => setState(() {}),
            ),
            TextField(
              controller: _description,
              maxLength: 300,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Description'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Public'),
              value: _isPublic,
              onChanged: (v) => setState(() => _isPublic = v),
            ),
            if (state.exportError != null)
              Text(state.exportError!, style: text.bodySmall?.copyWith(color: OrpheusColors.wineRedText)),
            const SizedBox(height: 8),
            ElevatedButton(
              onPressed: _name.text.trim().isEmpty
                  ? null
                  : () => notifier.exportPlaylist(
                        name: _name.text.trim(),
                        description: _description.text.trim(),
                        isPublic: _isPublic,
                      ),
              child: Text('Create ${state.derived.selected.length} tracks'),
            ),
          ],
        ),
      ExportStatus.exporting => Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Adding tracks… ${state.exportAdded} / ${state.exportTotal}', style: text.bodyMedium),
            const SizedBox(height: 12),
            LinearProgressIndicator(
              value: state.exportTotal == 0 ? null : state.exportAdded / state.exportTotal,
              color: OrpheusColors.lyreGold,
              backgroundColor: OrpheusColors.slate,
            ),
          ],
        ),
      ExportStatus.done => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Playlist created', style: text.titleMedium?.copyWith(color: OrpheusColors.lyreGold)),
            const SizedBox(height: 8),
            if (state.exportResult?['partial'] == true)
              Text(
                'Only ${state.exportResult?['addedCount']} of ${state.exportTotal} tracks were added — Spotify stopped the export.',
                style: text.bodySmall?.copyWith(color: OrpheusColors.wineRedText),
              ),
            const SizedBox(height: 12),
            if (state.exportResult?['spotifyPlaylistUrl'] is String)
              ElevatedButton.icon(
                onPressed: () => _open(state.exportResult!['spotifyPlaylistUrl'] as String),
                icon: const Icon(Icons.open_in_new_rounded),
                label: const Text('Open in Spotify'),
              ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () {
                notifier.startOver();
                Navigator.of(context).pop();
              },
              child: const Text('New playlist'),
            ),
            const SizedBox(height: 8),
            const SpotifyAttribution(style: SpotifyAttributionStyle.full),
          ],
        ),
    };

    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: body,
    );
  }
}
```

- [ ] **Step 9: `genre_playlist_builder.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../config/theme.dart';
import '../../providers/genre_builder_provider.dart';
import 'artist_filter_panel.dart';
import 'export_bar.dart';
import 'genre_family_picker.dart';
import 'secondary_filters.dart';
import 'track_preview_list.dart';

const _wideBreakpoint = 700.0;

/// "By genre" mode: side panel ≥ 700 px, stacked below.
class GenrePlaylistBuilder extends ConsumerWidget {
  const GenrePlaylistBuilder({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(genreBuilderProvider);
    final notifier = ref.read(genreBuilderProvider.notifier);
    final library = state.library;

    if (library == null) {
      return Center(
        child: state.loadingLibrary
            ? const CircularProgressIndicator(color: OrpheusColors.lyreGold)
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(state.libraryError ?? 'Could not load genres'),
                  TextButton(onPressed: notifier.loadLibrary, child: const Text('Retry')),
                ],
              ),
      );
    }

    final derived = state.derived;
    final sections = <(String, Widget)>[
      (
        'GENRES',
        GenreFamilyPicker(
          families: library.families,
          selected: state.families,
          excludedGenres: state.excludedGenres,
          untaggedCount: library.untaggedCount,
          syncProgress: library.syncProgress,
          onToggleFamily: notifier.toggleFamily,
          onToggleSubGenre: notifier.toggleSubGenre,
          onContinueSync: notifier.triggerGenreSync,
        ),
      ),
      (
        'ARTISTS',
        ArtistFilterPanel(
          artists: state.previewArtists,
          excluded: state.excludedArtistIds,
          forced: state.forcedArtistNames,
          onToggleExcluded: notifier.toggleArtistExcluded,
          onSearch: notifier.searchArtists,
          onForce: notifier.forceArtist,
          onRemoveForced: notifier.removeForcedArtist,
        ),
      ),
      (
        'FILTERS',
        SecondaryFilters(
          likedFrom: state.likedFrom,
          likedTo: state.likedTo,
          limit: state.limit,
          energyMin: state.energyMin,
          energyMax: state.energyMax,
          featuresAvailable: library.featuresAvailable,
          onLikedRange: notifier.setLikedRange,
          onLimit: notifier.setLimit,
          onEnergy: notifier.setEnergyRange,
        ),
      ),
    ];

    final list = TrackPreviewList(
      candidates: derived.candidates,
      uncheckedIds: state.uncheckedIds,
      selectedCount: derived.selected.length,
      selectedDurationMs: derived.selectedDurationMs,
      sort: state.sort,
      featuresAvailable: library.featuresAvailable,
      loading: state.loadingPreview,
      onToggle: notifier.toggleTrack,
      onSetAll: notifier.setAllChecked,
      onSort: notifier.setSort,
    );

    final bar = ExportBar(
      selectedCount: derived.selected.length,
      selectedDurationMs: derived.selectedDurationMs,
      onCreate: () => showExportSheet(context),
    );

    final error = state.previewError == null
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(state.previewError!, style: const TextStyle(color: OrpheusColors.wineRedText)),
          );

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= _wideBreakpoint) {
          return Column(
            children: [
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 320,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          for (final (label, widget) in sections) ...[
                            _label(context, label),
                            const SizedBox(height: 8),
                            widget,
                            const SizedBox(height: 20),
                          ],
                        ],
                      ),
                    ),
                    const VerticalDivider(width: 1, color: OrpheusColors.slate),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                        child: Column(children: [error, Expanded(child: list)]),
                      ),
                    ),
                  ],
                ),
              ),
              bar,
            ],
          );
        }
        // Narrow: collapsible sections above a fixed-height list.
        return Column(
          children: [
            Expanded(
              child: CustomScrollView(
                slivers: [
                  SliverList.list(
                    children: [
                      for (final (label, widget) in sections)
                        ExpansionTile(
                          title: _label(context, label),
                          initiallyExpanded: label == 'GENRES',
                          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                          children: [widget],
                        ),
                      error,
                    ],
                  ),
                  SliverFillRemaining(
                    hasScrollBody: true,
                    child: Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: list),
                  ),
                ],
              ),
            ),
            bar,
          ],
        );
      },
    );
  }

  Widget _label(BuildContext context, String text) => Text(
        text,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: OrpheusColors.lyreGold,
              letterSpacing: 3,
            ),
      );
}
```
(`SliverFillRemaining(hasScrollBody: true)` gives the inner `ListView` bounded height equal to the viewport, so the 3000+ row list stays lazily built.)

- [ ] **Step 10: Mode switch in `playlist_screen.dart`**

1. Add imports:
```dart
import '../widgets/genre_builder/genre_playlist_builder.dart';
```
2. Add state field in `_PlaylistScreenState`: `String _mode = 'prompt';`
3. Replace the `body:` of the `Scaffold` in `build` with:
```dart
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
              child: SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'prompt', label: Text('From a prompt'), icon: Icon(Icons.auto_awesome, size: 16)),
                  ButtonSegment(value: 'genre', label: Text('By genre'), icon: Icon(Icons.category_rounded, size: 16)),
                ],
                selected: {_mode},
                onSelectionChanged: (v) => setState(() => _mode = v.first),
              ),
            ),
            Expanded(
              child: _mode == 'genre'
                  ? const GenrePlaylistBuilder()
                  : switch (state.status) {
                      PlaylistGenerationStatus.idle => _buildForm(),
                      PlaylistGenerationStatus.generating => _buildProgress(state),
                      PlaylistGenerationStatus.complete => _buildResult(state),
                      PlaylistGenerationStatus.error => _buildError(state),
                    },
            ),
          ],
        ),
      ),
```

- [ ] **Step 11: Analyze + all client tests**

Run:
```bash
cd client && /Users/matella/Coding/SDK/flutter/bin/flutter analyze && /Users/matella/Coding/SDK/flutter/bin/flutter test
```
Expected: analyze reports exactly the 5 baseline issues; all tests PASS. Fix any new analyzer issue in the new files before committing (e.g. unnecessary `const`, unused import).

- [ ] **Step 12: Visual check on web (manual)**

Run the server (`cd server && npm run dev`) and the client:
```bash
cd client && /Users/matella/Coding/SDK/flutter/bin/flutter run -d chrome
```
Check: Playlist tab → "By genre"; family chips load with counts; picking K-pop fills the list; unchecking a track updates "N / M selected"; excluding an artist removes its tracks; resizing the window below 700 px switches to the stacked layout; Create opens the sheet.

- [ ] **Step 13: Commit**

```bash
git add client/lib/widgets/genre_builder client/lib/screens/playlist_screen.dart client/test/genre_family_picker_test.dart
git commit -m "feat(client): genre playlist builder UI with side-panel layout

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Documentation + final verification

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: Update `CLAUDE.md`**

1. Line starting `- **API** (\`api/\`) — Fastify routes grouped by domain (` → add `library, genre-playlists` to the domain list and append this sentence to the bullet:
   `Genre playlist routes: \`GET /api/library/genres\`, \`POST /api/library/genres/sync\`, \`GET /api/library/artists?q=\`, \`GET /api/library/artists/:artistId/liked-tracks\`, \`POST /api/genre-playlists/preview\`, \`POST /api/genre-playlists/order\`, \`POST /api/genre-playlists/export\`.`
2. After the `playlist-generator.ts` bullet (under Intelligence Pipeline), add:
   ```markdown
     - `genre-families.ts` — Loads `data/genre_families.json`; `classifyGenre()` maps a Spotify genre to the first family whose pattern it contains, else `other`.
     - `genre-playlist.ts` — Genre builder service: family/sub-genre counts over Liked Songs, uncapped preview filter (a track's genres = union over all its artists; AI genre only as fallback), smooth ordering via `track-ordering.ts`.
     - `track-ordering.ts` — `greedyNearestNeighbor` / `transitionCost`, shared by the generator and the genre builder.
   ```
3. In the **Spotify** bullet, append: `Playlists use \`POST /me/playlists\` and \`POST /playlists/{id}/items\` (Feb 2026 API). \`artist-genre-sync.ts\` fetches genres one artist at a time (\`GET /artists/{id}\`), throttled ~5 req/s, 4-min budget per cron run, resumable, emits \`genre_sync_progress\`. Saved-tracks sync stores \`liked_at\` and all track artists, and clears \`liked_at\` for un-liked tracks after a complete pass.`
4. **Database** bullet: replace `**8 migration versions** (v7: \`dj_preferences\` table; v8: \`tts_enabled\`, \`tts_voice\`, \`tts_duck_volume\` columns). 14 repository classes.` with `**9 migration versions** (v7: \`dj_preferences\` table; v8: \`tts_enabled\`, \`tts_voice\`, \`tts_duck_volume\` columns; v9: \`tracks.liked_at\`, \`tracks.features_source\`, \`artists\`, \`artist_genres\`, \`track_artists\`). 16 repository modules. \`runMigrations(db, targetVersion?)\` lets tests build older schemas.`
5. In **Client → Screens**, change `Playlist (generation form + result view)` to `Playlist ("From a prompt" generation form + result view, or "By genre" builder: \`widgets/genre_builder/\`, side panel ≥ 700 px, stacked below; state in \`genre_builder_provider.dart\`, pure derivation in \`models/genre_builder_models.dart\`)`.
6. Replace the constraint line `- **Flutter SDK is NOT installed** on this machine — client files are created/edited manually. Do not run \`flutter\` commands.` with:
   `- **Flutter SDK** lives at \`/Users/matella/Coding/SDK/flutter\` (not on PATH — call \`/Users/matella/Coding/SDK/flutter/bin/flutter\`). Use it for \`flutter analyze\` / \`flutter test\` / \`flutter run -d chrome\`. Android/Xcode toolchains are not installed.`
7. Under **Development Commands → Server**, the `npm run test` line stays; add under it: `# Tests use an in-memory DB (tests/helpers/db.ts); vitest.config.ts sets dummy Spotify env vars`.

- [ ] **Step 2: Update `README.md`**

1. After the `### Playlist Generation` feature list (before `### AI Integration (Optional)`), add:
   ```markdown
   ### Genre Playlists
   - Build a Spotify playlist from your Liked Songs by genre family (e.g. every K-pop track among thousands of likes) — no track cap
   - Families group Spotify sub-genres (K-pop = k-pop girl group, k-pop boy group, k-rap…); uncheck sub-genres individually
   - A track matches through any of its artists, so featurings count
   - Preview before creating: uncheck tracks, exclude or force-add artists, filter by liked date, limit the count, sort (date liked, artist, title, shuffle, smooth transitions when audio features exist)
   - Side-panel layout on desktop/web, stacked on mobile
   - Artist genres sync in the background (one artist at a time, resumable) with live progress
   ```
2. In the API table, after the row `| Playlists | \`/playlists/:id\` | DELETE | Delete playlist from local DB |`, add:
   ```markdown
   | Library | `/library/genres` | GET | Genre families + counts over Liked Songs, sync progress |
   | Library | `/library/genres/sync` | POST | Start artist-genre sync (409 if running) |
   | Library | `/library/artists?q=` | GET | Search artists on liked tracks |
   | Library | `/library/artists/:artistId/liked-tracks` | GET | All liked tracks of an artist |
   | Genre Playlists | `/genre-playlists/preview` | POST | Uncapped liked-track preview for genre filters |
   | Genre Playlists | `/genre-playlists/order` | POST | Smooth-transition ordering of track ids |
   | Genre Playlists | `/genre-playlists/export` | POST | Create a Spotify playlist from ordered track ids |
   ```
3. Project structure: `migrations.ts         # Schema v1-v8` → `migrations.ts         # Schema v1-v9`; under the intelligence entries add `genre-families.ts`, `genre-playlist.ts`, `track-ordering.ts`; under spotify add `artist-genre-sync.ts`; under client add `models/genre_builder_models.dart`, `providers/genre_builder_provider.dart`, `widgets/genre_builder/`.
4. Database schema: `SQLite with 8 migration versions:` → `SQLite with 9 migration versions:` and add after the v8 bullet:
   `- **v9:** Genre playlists — \`tracks.liked_at\` (Liked Songs date, cleared when un-liked), \`tracks.features_source\` (\`spotify\` | \`default\`), \`artists\`, \`artist_genres\` (all Spotify genres per artist), \`track_artists\` (every artist of a track, in order)`

- [ ] **Step 3: Full verification**

Run:
```bash
cd server && npx vitest run && npx tsc --noEmit && npm run build
cd ../client && /Users/matella/Coding/SDK/flutter/bin/flutter analyze && /Users/matella/Coding/SDK/flutter/bin/flutter test
```
Expected: all server tests PASS (8 files); tsc exit 0; build succeeds; analyze shows only the 5 baseline issues; all client tests PASS (3 files).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: genre playlists, migration v9, Feb 2026 Spotify endpoints, Flutter SDK path

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Manual test checklist (after deploy)

1. Restart the server → logs show `Running migration v9` then `Loaded genre families`.
2. Wait for the startup full sync → `Saved tracks sync complete` with `unliked` count; `Artist genre sync` logs progress (may stop at the 4-min budget — expected).
3. Playlist tab → **By genre**: sync bar visible while incomplete; **Continue sync** resumes it.
4. Select **K-pop** → list fills, count matches the chip; sub-genres appear and unchecking `k-rap` shrinks the list.
5. Exclude an artist → its tracks (including featurings) disappear; force-add a mis-tagged artist → 📌 chip and its tracks appear.
6. Date range and max-tracks limit update the "N / M selected" header.
7. Create → sheet → name defaults to "K-pop — Orpheus" → progress bar → **Open in Spotify** shows the playlist in the chosen order.
8. The prompt-based generator ("From a prompt") still creates playlists (uses the new endpoints).
