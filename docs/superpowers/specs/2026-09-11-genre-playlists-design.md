# Genre Playlists — Design

**Date:** 2026-09-11
**Status:** Approved in brainstorming, pending spec review
**Branch:** `feature/genre-playlists`

## Goal

Let the user build a Spotify playlist from their **Liked Songs** filtered by genre — e.g. "every K-pop track among my 7000+ likes" — and customize it in a preview UI before it is created on Spotify.

## Decisions

| Topic | Decision |
|---|---|
| Source | Spotify Liked Songs only (`/me/tracks`, already synced) |
| Genre selection | Genre **families** (e.g. K-pop) grouping Spotify sub-genres; sub-genres can be unchecked individually |
| Preview customization | Uncheck tracks; exclude artists / force-include artists; sort; secondary filters (liked-date range, track limit, energy range when real audio features exist) |
| Export | Always creates a **new** playlist (name, description, public/private) |
| Architecture | **Stateless preview** (approach A): server filters, client holds all customization state, export receives the final ordered list of track IDs |
| Client layout | **Side panel** (filters left, list right) at ≥ 700 px; stacked single screen below 700 px — same block widgets in both |

Out of scope: other playlists as a source, updating/replacing an existing playlist, auto-updating "living" playlists, server-side drafts.

## Current-state findings that drive the design

- `tracks.source = 'library'` is sticky — a track un-liked on Spotify is never reset. No liked date is stored.
- `genre_cluster` stores only `artist.genres[0]` of the **first** artist of the track.
- The existing playlist generator (`intelligence/playlist-generator.ts`) caps at 100 tracks, 180 min, 3 per artist, samples 500 random candidates and pads with off-genre tracks when fewer than 20 match. It is a scoring engine, not a filter — it is left unchanged apart from the Spotify endpoint migration.
- Audio features may be neutral defaults (0.5 everywhere) after a Spotify 403; energy-based features must be hidden in that case.
- Spotify's February 2026 Development Mode changes remove `POST /users/{user_id}/playlists` (→ `POST /me/playlists`), rename `POST /playlists/{id}/tracks` (→ `POST /playlists/{id}/items`), and remove batch `GET /artists?ids=` (→ `GET /artists/{id}`). Enforcement for existing apps was postponed with no published date; we migrate now.

## 1. Data & Spotify

### Migration v9 (`database/migrations.ts`)

- `tracks.liked_at TEXT NULL` — `added_at` from `/me/tracks`. Source of truth for "is in Liked Songs".
- `tracks.features_source TEXT NULL` — `'spotify'` | `'default'`. Backfill: tracks with `features_fetched = 1` and the exact neutral default values set by `markTracksWithDefaultFeatures()` → `'default'`; other fetched tracks → `'spotify'`.
- `artists (artist_id TEXT PRIMARY KEY, name TEXT NOT NULL, genres_fetched_at TEXT NULL)`.
- `artist_genres (artist_id TEXT NOT NULL, genre TEXT NOT NULL, PRIMARY KEY (artist_id, genre))` + index on `genre`.
- `track_artists (track_id INTEGER NOT NULL, artist_id TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (track_id, artist_id))` + index on `artist_id`.
- Backfill `track_artists` from existing `tracks.artist_id` (position 0) and `artists` rows from those IDs (name = first segment of `tracks.artist`).
- `liked_at` backfill: left `NULL`; the next full sync fills it. `CURRENT_VERSION` → 9.

`genre_cluster` is kept and still populated (the engine, scorer and curator depend on it).

### Sync changes (`spotify/library.ts`)

- `syncSavedTracks()` records `added_at` → `liked_at` and **all** artists → `track_artists`/`artists`. After a complete pass (no early break, no error), tracks with `liked_at IS NOT NULL` that were not seen in this pass get `liked_at = NULL`. Done inside a SAVEPOINT.
- `syncAudioFeatures()` sets `features_source = 'spotify'` on success; `markTracksWithDefaultFeatures()` sets `'default'`.
- `syncArtistGenres()` is rewritten:
  - Picks artists with `genres_fetched_at IS NULL` (all artists of liked tracks first).
  - Calls `GET /artists/{id}` one at a time, throttled (~5 req/s), honoring `429` + `Retry-After`, and stopping cleanly on a `QUOTA_EXCEEDED` 429 or 403 (resumes next run).
  - Stores every genre in `artist_genres`, sets `genres_fetched_at` (also when the artist has no genres), and keeps updating `tracks.genre_cluster` with the first genre of the track's first artist as today.
  - Emits WebSocket `genre_sync_progress { done, total }`.
  - Guarded by an in-process flag so the cron and the manual trigger never run concurrently.

### Spotify endpoints (`spotify/player.ts`)

- `createSpotifyPlaylist(name, description, isPublic)` → `POST /me/playlists` (drops the `/me` lookup).
- `addTracksToPlaylist(playlistId, uris)` → `POST /playlists/{id}/items`, batches of 100. Returns the number of URIs successfully added; throws a typed error carrying that count on failure mid-way.

### Genre families (`data/genre_families.json`, loaded like `genre_aliases.json`)

```json
{ "families": [
  { "id": "k-pop", "label": "K-pop", "patterns": ["k-pop", "korean", "k-rap", "k-indie", "k-rock", "k-ballad"] },
  { "id": "j-pop", "label": "J-pop", "patterns": ["j-pop", "japanese", "anime", "j-rock", "city pop"] }
] }
```

- A Spotify genre belongs to the **first** family (file order) with a pattern that is a substring of the lower-cased genre. Unmatched genres fall into the synthetic family `other` (label "Other"), shown with their raw names.
- Initial file covers ~20 families (k-pop, j-pop, c-pop, hip-hop, r&b, pop, rock, metal, punk, indie, electronic, house, techno, jazz, classical, latin, country, folk, soul/funk, lo-fi, ambient, reggae).
- A track's genres = union of `artist_genres` over **all** its artists. If that set is empty and `genre_source = 'ai'`, `genre_cluster` is used as its single genre.

## 2. API & service

New service `intelligence/genre-playlist.ts` (pure query + mapping logic, no Fastify) and a shared `intelligence/track-ordering.ts` holding `greedyNearestNeighbor` / `transitionCost` extracted from `playlist-generator.ts` (which then imports it).

Routes in `api/routes/genre-playlist.routes.ts`, registered under `/api`. All bodies validated with Zod.

### `GET /api/library/genres`

Counts over liked tracks only, families and sub-genres sorted by descending count.

```json
{ "families": [{ "id": "k-pop", "label": "K-pop", "trackCount": 842,
    "genres": [{ "name": "k-pop girl group", "trackCount": 410 }] }],
  "untaggedCount": 312,
  "featuresAvailable": false,
  "genreSyncProgress": { "done": 1830, "total": 2140, "running": true } }
```

`featuresAvailable` = at least one liked track has `features_source = 'spotify'`.

### `POST /api/library/genres/sync`

Starts the artist-genre sync in the background; returns `202 { started: true }` or `409` if already running.

### `POST /api/genre-playlists/preview`

```json
{ "families": ["k-pop"], "includeGenres": [], "excludeGenres": ["k-rap"],
  "likedFrom": "2023-01-01", "likedTo": null, "energyMin": null, "energyMax": null }
```

- Rule: a liked track matches if (any of its genres is in a selected family **OR** in `includeGenres`) **AND** none of its genres is in `excludeGenres`, AND it passes the date/energy filters. At least one of `families` / `includeGenres` is required (400 otherwise).
- Energy filters are ignored when `featuresAvailable` is false.
- No cap. Response:

```json
{ "tracks": [{ "id": 1, "spotifyId": "…", "name": "…", "artist": "…", "albumArtUrl": "…",
               "durationMs": 180000, "likedAt": "2024-05-01T…", "energy": 0.7,
               "artistIds": ["…"], "matchedGenres": ["k-pop girl group"] }],
  "artists": [{ "artistId": "…", "name": "aespa", "trackCount": 38 }] }
```

### `GET /api/library/artists?q=` and `GET /api/library/artists/:artistId/liked-tracks`

Artist search among liked-track artists (limit 20) and all liked tracks of one artist (same track shape as preview). 404 on unknown artist.

### `POST /api/genre-playlists/order`

`{ trackIds: number[] }` → `{ trackIds: number[] }` ordered by the extracted nearest-neighbor ordering. 400 when `featuresAvailable` is false.

### `POST /api/genre-playlists/export`

`{ trackIds: number[] (1–10000, final order), name (1–100 chars), description (≤300), isPublic }`

- Unknown IDs → 400.
- Creates the playlist, adds items in batches of 100, emitting WebSocket `genre_playlist_export_progress { added, total }`.
- Persists into the existing `playlists` table (`prompt = "genre:" + families joined by ","`, `energy_arc = 'steady'`, AI flags false) plus `playlist_tracks`.
- Response `{ id, spotifyPlaylistId, spotifyPlaylistUrl, trackCount, partial, addedCount }`.
- Spotify 401 → auth error (existing handler); 429 → retried with backoff inside `spotifyFetch`; mid-way failure → `partial: true` with the URL and `addedCount`.

## 3. Client (Flutter)

- `PlaylistScreen` gains a `SegmentedButton` **From a prompt | By genre**; "From a prompt" is the current form, untouched. "By genre" renders `GenrePlaylistBuilder`.
- `GenrePlaylistBuilder` uses `LayoutBuilder`: ≥ 700 px → 320 px scrollable filter panel left + list right + bottom `ExportBar`; < 700 px → one scroll view with the filter blocks as `ExpansionTile`s above the list.
- Widgets in `lib/widgets/genre_builder/`, one per file:
  - `genre_family_picker.dart` — multi-select family chips with counts; expand to uncheck sub-genres (→ `excludeGenres`); untagged count; genre-sync progress bar + "Continue sync" button.
  - `artist_filter_panel.dart` — result artists with counts and exclusion checkboxes; search field to force-include an artist (📌 tag).
  - `secondary_filters.dart` — liked-date range (`showDateRangePicker`), track limit (empty = unlimited), energy `RangeSlider` only when `featuresAvailable`.
  - `track_preview_list.dart` — `ListView.builder`; checkbox, cover, title, artist, liked date; header "812 / 842 selected · 52 h", select/unselect all, sort menu (liked date ↓/↑, artist, title, shuffle, smooth transitions when available).
  - `export_bar.dart` + `export_sheet.dart` — "Create · N tracks"; sheet with name (default "<Family> — Orpheus"), description, public switch; progress; result with "Open in Spotify" / "New playlist"; partial-failure warning.
- State: `lib/providers/genre_builder_provider.dart`, a `Notifier` following `PlaylistNotifier`'s pattern.
  - Server filters (families, excluded sub-genres, dates, energy) → debounced (400 ms) `preview` call.
  - Local customization (unchecked IDs, excluded artists, forced artists + their tracks, sort, limit) → in-memory only.
  - `visibleTracks` = (preview tracks ∪ forced-artist tracks) − excluded-artist tracks − unchecked, then sorted, then limited. Unchecked IDs survive a new preview when still present.
- `ApiService` gains: `getLibraryGenres`, `triggerGenreSync`, `previewGenrePlaylist`, `searchLibraryArtists`, `getArtistLikedTracks`, `orderTracksSmooth`, `exportGenrePlaylist`.

## 4. Testing & rollout

### Server (vitest — first tests in the repo)

- Test helper creating an in-memory `node:sqlite` DB with all migrations applied.
- `genre-families.test.ts` — family assignment (`k-pop girl group` → k-pop, `korean r&b` → k-pop, `j-pop` ≠ k-pop, unknown → other).
- `genre-playlist.test.ts` — featured artist's genre counts; `excludeGenres` wins; date range; un-liked excluded; AI genre only as fallback; no 100-track cap.
- `migrations.test.ts` — v9 over a v8 DB: columns present, `features_source` backfilled, `track_artists` backfilled.
- `spotify-playlist.test.ts` (mocked `spotifyFetch`) — `POST /me/playlists`; 250 URIs → 3 `/items` calls; partial failure; artist sync honors `Retry-After` and stops on quota.
- Route tests via `fastify.inject` — Zod 400s, export bounds 1–10000.

### Client

Flutter SDK available at `/Users/matella/Coding/SDK/flutter` (upgraded 2026-09-11 to 3.47.3 stable, Dart 3.13.3 — satisfies `pubspec.lock`; Android/Xcode toolchains not installed, irrelevant for analyze/test/web). Run `flutter analyze` and `flutter test` with the full path; add widget tests for `genre_builder_provider` derivation (`visibleTracks`) and `GenreFamilyPicker`. Manual checklist delivered with the PR.

### Rollout order (one commit each)

1. Spotify endpoint migration (`/me/playlists`, `/items`) — also fixes the existing generator.
2. Migration v9 + sync changes (`liked_at`, `track_artists`, `features_source`).
3. Per-artist genre sync + `genre_families.json`.
4. Genre-playlist service + routes + tests.
5. Flutter client + tests.
6. CLAUDE.md / README update (incl. Flutter SDK path, migration count, new routes).

First run after deploy: the next full sync fills `liked_at` and artists; genres fill over a few minutes while the widget shows sync progress.
