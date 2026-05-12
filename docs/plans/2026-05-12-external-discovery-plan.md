# External Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the local-library-only "similar" and "discovery" pool buckets with real Spotify Recommendations API calls, and save any externally-picked tracks to the DB as first-class rows.

**Architecture:** A new `recommendations.ts` wrapper calls `GET /recommendations` and `GET /audio-features`. `buildCuratorPool()` becomes async and uses these for the similar/discovery buckets (falling back to the existing DB filter if the API returns empty). `curator.ts` detects external track IDs (Spotify base62 vs DB integers), saves them to the DB at pick time, then queues them normally.

**Tech Stack:** Node.js/TypeScript ESM, `spotifyFetch<T>` (existing auth wrapper in `spotify/client.ts`), `node:sqlite` via existing repo functions.

---

## Context

Read these files before starting — they contain the exact interfaces and patterns you must follow:

- `server/src/spotify/client.ts` — `spotifyFetch<T>(endpoint, options?)` is the authenticated HTTP wrapper. Use this for all Spotify API calls. It handles token refresh and 429 retries automatically.
- `server/src/intelligence/pool-builder.ts` — `buildCuratorPool()` you will make async.
- `server/src/intelligence/curator.ts` — `_validateAndResolvePicks()` you will make async. It currently calls `getTrackById(Number(tid))` — you must extend it.
- `server/src/ai/prompts.ts` — `CandidateTrack` interface you will extend.
- `server/src/database/repositories/track.repo.ts` — `upsertTrack()`, `updateAudioFeatures()`, `getTrackBySpotifyId()` already exist. Use them. Do NOT add new repo functions.
- `server/src/database/repositories/top-artists.repo.ts` — `getTopArtists('short_term', N)` returns rows with `spotify_id` (Spotify artist ID).

## Key Constraints

- **No new DB migration** — external tracks use the existing `tracks` table with `source = 'external'`.
- **ESM imports** — all imports must use `.js` extension.
- **Fallback is required** — if Spotify recommendations returns empty/errors, silently fall back to the existing DB filter. The pool must always be built.
- **No test files exist** in this project — verification is TypeScript (`npx tsc --noEmit`) and manual inspection.
- **Max 5 seeds total** for Spotify recommendations (tracks + artists combined).

---

### Task 1: Create `server/src/spotify/recommendations.ts`

**Files:**
- Create: `server/src/spotify/recommendations.ts`

**Step 1: Write the file**

```typescript
import { spotifyFetch } from './client.js';
import { logger } from '../shared/logger.js';

export interface SpotifyRecommendedTrack {
  spotifyId: string;
  spotifyUri: string;
  name: string;
  artist: string;
  artistId: string;
  album: string | null;
  durationMs: number;
  popularity: number;
}

export interface RecommendationOpts {
  seedTrackIds?: string[];
  seedArtistIds?: string[];
  targetEnergy?: number;
  targetValence?: number;
  limit?: number;
}

/**
 * Call GET /recommendations. Returns [] on any error (never throws).
 * Spotify enforces a max of 5 seeds total (tracks + artists).
 */
export async function getRecommendations(opts: RecommendationOpts): Promise<SpotifyRecommendedTrack[]> {
  const seedTracks = (opts.seedTrackIds ?? []).slice(0, 2);
  const seedArtists = (opts.seedArtistIds ?? []).slice(0, 5 - seedTracks.length);

  if (seedTracks.length + seedArtists.length === 0) return [];

  const params = new URLSearchParams();
  if (seedTracks.length) params.set('seed_tracks', seedTracks.join(','));
  if (seedArtists.length) params.set('seed_artists', seedArtists.join(','));
  if (opts.targetEnergy !== undefined) params.set('target_energy', opts.targetEnergy.toFixed(2));
  if (opts.targetValence !== undefined) params.set('target_valence', opts.targetValence.toFixed(2));
  params.set('limit', String(Math.min(opts.limit ?? 20, 100)));

  try {
    const data = await spotifyFetch<{ tracks: unknown[] }>(`/recommendations?${params}`);
    return (data.tracks ?? []).map((t: any) => ({
      spotifyId: t.id as string,
      spotifyUri: t.uri as string,
      name: t.name as string,
      artist: (t.artists?.[0]?.name ?? 'Unknown') as string,
      artistId: (t.artists?.[0]?.id ?? '') as string,
      album: (t.album?.name ?? null) as string | null,
      durationMs: t.duration_ms as number,
      popularity: t.popularity as number,
    }));
  } catch (err) {
    logger.warn({ err }, 'Spotify recommendations failed — using library fallback');
    return [];
  }
}

/**
 * Fetch audio features for a single track via GET /audio-features?ids={id}.
 * Returns null on any error.
 */
export async function getTrackAudioFeatures(spotifyId: string): Promise<{
  energy: number;
  valence: number;
  tempo: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  loudness: number;
  speechiness: number;
  key: number;
  mode: number;
  timeSignature: number;
} | null> {
  try {
    const data = await spotifyFetch<{ audio_features: unknown[] }>(
      `/audio-features?ids=${spotifyId}`,
    );
    const f: any = (data.audio_features ?? [])[0];
    if (!f) return null;
    return {
      energy: f.energy,
      valence: f.valence,
      tempo: f.tempo,
      danceability: f.danceability,
      acousticness: f.acousticness,
      instrumentalness: f.instrumentalness,
      loudness: f.loudness,
      speechiness: f.speechiness,
      key: f.key,
      mode: f.mode,
      timeSignature: f.time_signature,
    };
  } catch (err) {
    logger.warn({ err, spotifyId }, 'Audio features fetch failed for external track');
    return null;
  }
}
```

**Step 2: TypeScript check**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add server/src/spotify/recommendations.ts
git commit -m "feat: add Spotify recommendations + audio-features wrapper"
```

---

### Task 2: Extend `CandidateTrack` with external-track fields

**Files:**
- Modify: `server/src/ai/prompts.ts` (find `CandidateTrack` interface, around line 522)

**Step 1: Find the current interface**

It looks like:
```typescript
export interface CandidateTrack {
  trackId: string;
  name: string;
  artist: string;
  year: number | null;
  genres: string[];
  source: 'library' | 'similar' | 'discovery';
}
```

**Step 2: Add external-only fields**

Replace the interface with:
```typescript
export interface CandidateTrack {
  trackId: string;        // DB integer string for library tracks; Spotify track ID for external
  name: string;
  artist: string;
  year: number | null;
  genres: string[];
  source: 'library' | 'similar' | 'discovery';
  // External-only fields — present when trackId is a Spotify ID, not a DB integer
  spotifyUri?: string;
  artistId?: string;
  album?: string;
  durationMs?: number;
  popularity?: number;
}
```

**Step 3: TypeScript check**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors (the new fields are optional, so existing usages still compile).

**Step 4: Commit**

```bash
git add server/src/ai/prompts.ts
git commit -m "feat: extend CandidateTrack with external-track metadata fields"
```

---

### Task 3: Make `buildCuratorPool()` async with Spotify recommendations

**Files:**
- Modify: `server/src/intelligence/pool-builder.ts`

**Step 1: Add imports at the top**

Add after the existing imports:
```typescript
import { getRecommendations } from '../spotify/recommendations.js';
import { getTopArtists } from '../database/repositories/top-artists.repo.js';
import { getDb } from '../database/connection.js';
```

**Step 2: Change the function signature to async and add `currentTrack` param**

Change:
```typescript
export function buildCuratorPool(
  sessionId: number,
  appetite: DiscoveryAppetite,
  recentTrackIds: Set<number>,
  recentArtists: Set<string>,
): CandidateTrack[] {
```

To:
```typescript
export async function buildCuratorPool(
  sessionId: number,
  appetite: DiscoveryAppetite,
  recentTrackIds: Set<number>,
  recentArtists: Set<string>,
  currentTrack?: { spotifyId: string } | null,
): Promise<CandidateTrack[]> {
```

**Step 3: Add a helper to get all existing Spotify IDs from DB**

Add this line right after `const recentArtistSet = ...` (around line 135):
```typescript
  const existingSpotifyIds = new Set(
    (getDb().prepare('SELECT spotify_id FROM tracks').all() as { spotify_id: string }[]).map(
      (r) => r.spotify_id,
    ),
  );
```

**Step 4: Replace the similar bucket**

Find the current similar bucket section:
```typescript
  // Similar: same genre as current state, not same artist as very recent
  const similarRows = notInLibrary.filter(
    (t) =>
      currentGenre && t.genre_cluster === currentGenre &&
      !recentArtistSet.has(t.artist.toLowerCase()),
  );
```

Replace with:
```typescript
  // Similar bucket — Spotify recommendations seeded by current track/artist
  let similarBucket: CandidateTrack[];
  if (currentTrack) {
    // Look up the current track's artist_id from DB for a richer seed
    const currentTrackRow = getDb()
      .prepare('SELECT artist_id FROM tracks WHERE spotify_id = ?')
      .get(currentTrack.spotifyId) as { artist_id: string | null } | undefined;
    const artistId = currentTrackRow?.artist_id ?? null;

    const simRecs = await getRecommendations({
      seedTrackIds: [currentTrack.spotifyId],
      seedArtistIds: artistId ? [artistId] : [],
      targetEnergy: stateVector?.energy,
      targetValence: stateVector?.valence,
      limit: simTarget + 10,
    });

    const filtered = simRecs.filter(
      (t) =>
        !existingSpotifyIds.has(t.spotifyId) &&
        !recentTrackIds.has(0) && // placeholder — external tracks have no DB id yet
        !recentArtistSet.has(t.artist.toLowerCase()),
    );

    if (filtered.length > 0) {
      similarBucket = filtered.slice(0, simTarget).map((t) => ({
        trackId: t.spotifyId,
        name: t.name,
        artist: t.artist,
        year: null,
        genres: [],
        source: 'similar' as const,
        spotifyUri: t.spotifyUri,
        artistId: t.artistId,
        album: t.album,
        durationMs: t.durationMs,
        popularity: t.popularity,
      }));
    } else {
      // Fallback to local DB filter
      const similarRows = notInLibrary.filter(
        (t) =>
          currentGenre &&
          t.genre_cluster === currentGenre &&
          !recentArtistSet.has(t.artist.toLowerCase()),
      );
      similarBucket = shuffled(similarRows).slice(0, simTarget).map((t) => toCandidate(t, 'similar'));
    }
  } else {
    // No current track — fall back to local DB filter
    const similarRows = notInLibrary.filter(
      (t) =>
        currentGenre &&
        t.genre_cluster === currentGenre &&
        !recentArtistSet.has(t.artist.toLowerCase()),
    );
    similarBucket = shuffled(similarRows).slice(0, simTarget).map((t) => toCandidate(t, 'similar'));
  }
```

**Step 5: Replace the discovery bucket**

Find the current discovery bucket section:
```typescript
  // Discovery: different genre (or no genre match), bias toward low play count
  const discoveryFiltered = notInLibrary.filter(
    (t) => !currentGenre || t.genre_cluster !== currentGenre,
  );
  // Pre-fetch play counts to avoid O(n log n) DB reads inside sort comparator
  const playCountById = new Map<number, number>();
  for (const t of discoveryFiltered) {
    playCountById.set(t.id, getPreference(t.id)?.play_count ?? 0);
  }
  const discoveryRows = discoveryFiltered.sort(
    (a, b) => (playCountById.get(a.id) ?? 0) - (playCountById.get(b.id) ?? 0),
  );

  const similarBucket = shuffled(similarRows).slice(0, simTarget).map((t) => toCandidate(t, 'similar'));
  const discoveryBucket = discoveryRows.slice(0, discTarget).map((t) => toCandidate(t, 'discovery'));
```

Replace with (note: `similarBucket` is now declared above, so only declare `discoveryBucket` here):
```typescript
  // Discovery bucket — Spotify recommendations seeded by diverse top artists
  let discoveryBucket: CandidateTrack[];
  const topArtistRows = getTopArtists('short_term', 10);
  const diverseArtistIds = topArtistRows
    .filter((a) => a.name.toLowerCase() !== currentTrack?.spotifyId) // filter by name mismatch is rough; just take a few
    .slice(0, 3)
    .map((a) => a.spotify_id)
    .filter(Boolean) as string[];

  const discRecs = await getRecommendations({
    seedArtistIds: diverseArtistIds,
    limit: discTarget + 10,
  });

  const discFiltered = discRecs.filter(
    (t) =>
      !existingSpotifyIds.has(t.spotifyId) &&
      !recentArtistSet.has(t.artist.toLowerCase()),
  );

  if (discFiltered.length > 0) {
    discoveryBucket = discFiltered.slice(0, discTarget).map((t) => ({
      trackId: t.spotifyId,
      name: t.name,
      artist: t.artist,
      year: null,
      genres: [],
      source: 'discovery' as const,
      spotifyUri: t.spotifyUri,
      artistId: t.artistId,
      album: t.album,
      durationMs: t.durationMs,
      popularity: t.popularity,
    }));
  } else {
    // Fallback to local DB filter
    const discoveryFiltered = notInLibrary.filter(
      (t) => !currentGenre || t.genre_cluster !== currentGenre,
    );
    const playCountById = new Map<number, number>();
    for (const t of discoveryFiltered) {
      playCountById.set(t.id, getPreference(t.id)?.play_count ?? 0);
    }
    const discoveryRows = discoveryFiltered.sort(
      (a, b) => (playCountById.get(a.id) ?? 0) - (playCountById.get(b.id) ?? 0),
    );
    discoveryBucket = discoveryRows.slice(0, discTarget).map((t) => toCandidate(t, 'discovery'));
  }
```

**Step 6: Remove now-unused imports**

After the refactor, `getPreference` may no longer be needed at the top level (it's still used in the fallback path). Keep it.

Remove `getTracksWithFeatures` from the import if it's no longer called directly. Check — it's called on line ~132 (`const allTracks = getTracksWithFeatures()`). The `notInLibrary` variable still uses `allTracks`. Keep the import.

**Step 7: Update the logger output**

The logger at the end logs `similar`, `discovery`, `total`. These still work since both buckets are now `CandidateTrack[]`. No change needed.

**Step 8: TypeScript check**

```bash
cd server && npx tsc --noEmit
```

Fix any errors before continuing.

**Step 9: Commit**

```bash
git add server/src/intelligence/pool-builder.ts
git commit -m "feat: use Spotify recommendations for similar/discovery pool buckets"
```

---

### Task 4: Handle external picks in `curator.ts`

**Files:**
- Modify: `server/src/intelligence/curator.ts`

**Step 1: Add new imports**

At the top of the file, add:
```typescript
import { getTrackAudioFeatures } from '../spotify/recommendations.js';
import {
  getTrackBySpotifyId,
  upsertTrack,
  updateAudioFeatures,
} from '../database/repositories/track.repo.js';
```

**Step 2: Make `buildCuratorPool` call async**

In the `curate()` method, find:
```typescript
    const pool = buildCuratorPool(
      sessionId,
      ctx.discoveryAppetite,
      this.recentTrackIds,
      this.recentArtists,
    );
```

Replace with:
```typescript
    const pool = await buildCuratorPool(
      sessionId,
      ctx.discoveryAppetite,
      this.recentTrackIds,
      this.recentArtists,
      currentTrack ? { spotifyId: currentTrack.spotifyId } : null,
    );
```

**Step 3: Make `_validateAndResolvePicks` async**

Change its signature from:
```typescript
  private _validateAndResolvePicks(
    raw: CurationResult,
    pool: CandidateTrack[],
    currentTrack: PlaybackTrack | null,
    sessionId: number,
  ): CuratorPick[] {
```

To:
```typescript
  private async _validateAndResolvePicks(
    raw: CurationResult,
    pool: CandidateTrack[],
    currentTrack: PlaybackTrack | null,
    sessionId: number,
  ): Promise<CuratorPick[]> {
```

**Step 4: Update the call site in `curate()`**

Find:
```typescript
    const picks = this._validateAndResolvePicks(raw, pool, currentTrack ?? null, sessionId);
```

Replace with:
```typescript
    const picks = await this._validateAndResolvePicks(raw, pool, currentTrack ?? null, sessionId);
```

**Step 5: Add `_resolveExternalTrack()` helper method**

Add this new private method to the class (after `_validateAndResolvePicks`):

```typescript
  /**
   * Resolve an external track by Spotify ID: return from DB if known, otherwise
   * fetch audio features, save to DB, and return the saved row.
   */
  private async _resolveExternalTrack(
    spotifyId: string,
    candidate: CandidateTrack,
  ): Promise<PlaybackTrack | null> {
    // Already in DB from a previous session?
    const existing = getTrackBySpotifyId(spotifyId);
    if (existing) {
      return trackRowToPlayback(existing, candidate.source);
    }

    // New track — save it
    try {
      upsertTrack({
        spotifyId,
        name: candidate.name,
        artist: candidate.artist,
        artistId: candidate.artistId,
        album: candidate.album,
        durationMs: candidate.durationMs ?? 0,
        source: 'external',
      });

      const features = await getTrackAudioFeatures(spotifyId);
      if (features) {
        updateAudioFeatures({ spotifyId, ...features });
      }

      const saved = getTrackBySpotifyId(spotifyId);
      if (!saved) return null;
      return trackRowToPlayback(saved, candidate.source);
    } catch (err) {
      logger.warn({ err, spotifyId }, 'Failed to save external track to DB');
      return null;
    }
  }
```

**Step 6: Update the pick-resolution loop inside `_validateAndResolvePicks`**

Find the current resolution loop:
```typescript
    for (const item of raw.picks ?? []) {
      const tid = item.track_id;
      if (!tid || !poolById.has(tid) || used.has(tid)) continue;

      const candidateTrack = poolById.get(tid)!;
      const dbRow = getTrackById(Number(tid));
      if (!dbRow) continue;

      dbRow.source = candidateTrack.source;
      picks.push({ track: dbRow, reason: item.reason ?? '' });
      used.add(tid);
      if (picks.length === 3) break;
    }
```

Replace with:
```typescript
    for (const item of raw.picks ?? []) {
      const tid = item.track_id;
      if (!tid || !poolById.has(tid) || used.has(tid)) continue;

      const candidateTrack = poolById.get(tid)!;

      // Detect external tracks: Spotify IDs are 22-char alphanumeric, not plain integers
      const isExternal = !/^\d+$/.test(tid);
      let resolvedTrack: PlaybackTrack | null;

      if (isExternal) {
        resolvedTrack = await this._resolveExternalTrack(tid, candidateTrack);
      } else {
        resolvedTrack = getTrackById(Number(tid));
        if (resolvedTrack) resolvedTrack.source = candidateTrack.source;
      }

      if (!resolvedTrack) continue;

      picks.push({ track: resolvedTrack, reason: item.reason ?? '' });
      used.add(tid);
      if (picks.length === 3) break;
    }
```

**Step 7: Update the backfill loop to skip external tracks**

Find the backfill section:
```typescript
    // Backfill if the LLM hallucinated or deduped fewer than 3
    if (picks.length < 3) {
      const usedDbIds = new Set(picks.map((p) => p.track.id));
      for (const candidate of pool) {
        if (picks.length >= 3) break;
        if (used.has(candidate.trackId)) continue;
        const dbRow = getTrackById(Number(candidate.trackId));
        if (!dbRow || usedDbIds.has(dbRow.id)) continue;
        dbRow.source = candidate.source;
        picks.push({ track: dbRow, reason: '(backfill)' });
        used.add(candidate.trackId);
      }
    }
```

Replace with:
```typescript
    // Backfill with library tracks only (skip external to avoid async audio-features calls)
    if (picks.length < 3) {
      const usedDbIds = new Set(picks.map((p) => p.track.id));
      for (const candidate of pool) {
        if (picks.length >= 3) break;
        if (used.has(candidate.trackId)) continue;
        if (candidate.spotifyUri) continue; // external — skip in backfill
        const dbRow = getTrackById(Number(candidate.trackId));
        if (!dbRow || usedDbIds.has(dbRow.id)) continue;
        dbRow.source = candidate.source;
        picks.push({ track: dbRow, reason: '(backfill)' });
        used.add(candidate.trackId);
      }
    }
```

**Step 8: TypeScript check**

```bash
cd server && npx tsc --noEmit
```

Fix any errors before continuing. Common things to check:
- `trackRowToPlayback` receives a `TrackRow` — `getTrackBySpotifyId` returns `TrackRow | null`, so null-guard is needed
- `getTrackById` in `curator.ts` is the local private function (line ~70), not the repo one — it returns `PlaybackTrack | null` directly, so no `.source` assignment needed; actually look at the function: it returns `PlaybackTrack` with `source` already set. The existing code `dbRow.source = candidateTrack.source` mutates it. Keep that.

**Step 9: Commit**

```bash
git add server/src/intelligence/curator.ts
git commit -m "feat: resolve external Spotify tracks in curator pick validation"
```

---

### Task 5: TypeScript final check + docs update

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Step 1: Full TypeScript check**

```bash
cd server && npx tsc --noEmit
```

Expected: zero errors. Fix anything before continuing.

**Step 2: Update CLAUDE.md**

In the server architecture section, update the pool-builder entry:
```
  - `pool-builder.ts` — Builds 40–60 track candidate pool. Similar/discovery buckets call Spotify Recommendations API (seeded by current track + top artists); falls back to local DB filter when API unavailable. Ratios adjusted for appetite and genreOpenness.
```

In the TTS section (`tts/`), add after it:
```
- **Discovery** (`spotify/recommendations.ts`) — `getRecommendations()` wraps `GET /recommendations`; `getTrackAudioFeatures()` wraps `GET /audio-features`. Both return empty/null on failure (never throw).
```

**Step 3: Update README.md**

In the DJ Curator feature section, update the discovery appetite description to mention external sources:
```
- Discovery appetite now sources "similar" and "discovery" tracks from Spotify Recommendations API (seeded by current track and top artists), surfacing music outside the saved library; falls back to local library when API unavailable
```

**Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: update architecture docs for external discovery via Spotify recommendations"
```
