# External Discovery — Design Spec

**Date:** 2026-05-12
**Branch:** feature/external-discovery (cut from main)

## Goal

Replace the "similar" and "discovery" pool buckets — currently both drawn from the user's local Spotify library — with real external recommendations from the Spotify Recommendations API. Tracks picked by the LLM that aren't in the local DB are saved as first-class rows so they contribute to listening history and future curation.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| External API | Spotify `/recommendations` | No extra credentials; already authenticated; returns Spotify URIs directly |
| Similar seed | Current track ID + artist ID | Gets tracks sonically close to what's playing now |
| Discovery seed | 2–3 diverse top artists (excluding current) | Broadens without genre-mapping complexity |
| Persistence | Save external picks to DB immediately | Enables likes/dislikes, state vector, session history, future library bucket |
| Audio features | Fetch at save time via `GET /audio-features/{id}` | Keeps track row complete; state vector works immediately |
| Fallback | Silent fallback to local DB filter | Pool still builds if recommendations API fails |

## Architecture

```
curator.ts
  │
  ▼
buildCuratorPool(sessionId, appetite, recentTrackIds, recentArtists, currentTrack?)
  │
  ├─ library bucket   ← getCandidates() [unchanged]
  ├─ similar bucket   ← GET /recommendations (seed: current track + artist)
  └─ discovery bucket ← GET /recommendations (seed: diverse top artists)
          │
          ▼
      filter: exclude tracks already in DB, exclude recent window
          │
          ▼
      CandidateTrack[] (spotifyUri populated for external tracks)
          │
          ▼
  LLM picks track_id (Spotify ID for external, DB int for library)
          │
          ▼
  curator.ts resolves pick:
    is Spotify ID? → findBySpotifyUri in DB
      found → queue normally
      not found → GET /audio-features → insertExternalTrack → queue by URI
    is DB int? → existing path [unchanged]
```

## New Files

**`server/src/spotify/recommendations.ts`**

```typescript
export interface SpotifyRecommendedTrack {
  spotifyId: string;      // e.g. "4iV5W9uYEdYUVa79Axb7Rh"
  spotifyUri: string;     // e.g. "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"
  name: string;
  artist: string;
  artistId: string;
  album: string | null;
  durationMs: number;
  popularity: number;
}

export async function getRecommendations(opts: {
  seedTrackIds?: string[];
  seedArtistIds?: string[];
  targetEnergy?: number;
  targetValence?: number;
  limit?: number;
}): Promise<SpotifyRecommendedTrack[]>

export async function getAudioFeatures(spotifyTrackId: string): Promise<{
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  loudness: number | null;
} | null>
```

Uses the existing `spotifyClient` (authenticated SDK wrapper). Returns `[]` and logs a warning on any API error.

## Modified Files

**`server/src/ai/prompts.ts`**

Add `spotifyUri?: string` to `CandidateTrack`:
```typescript
export interface CandidateTrack {
  trackId: string;        // DB int for library tracks; Spotify track ID for external
  name: string;
  artist: string;
  year: number | null;
  genres: string[];
  source: 'library' | 'similar' | 'discovery';
  spotifyUri?: string;    // populated for external tracks only
}
```

**`server/src/intelligence/pool-builder.ts`**

- `buildCuratorPool()` becomes `async`
- Accepts new optional param: `currentTrack?: { spotifyTrackId: string; spotifyArtistId: string | null }`
- Similar bucket: calls `getRecommendations({ seedTrackIds, seedArtistIds, targetEnergy, targetValence, limit: simTarget })`
- Discovery bucket: calls `getRecommendations({ seedArtistIds: diverseTopArtists, limit: discTarget })`
- Filters recommendations against existing DB tracks (by `spotify_uri`)
- Falls back to existing local DB filter if recommendations returns empty

**`server/src/intelligence/curator.ts`**

- Passes current track info into `buildCuratorPool()` (extracts Spotify track/artist ID from engine state)
- `await`s pool build
- In pick resolution: detects Spotify ID format (22-char alphanumeric, no spaces), calls `findTrackBySpotifyUri()`, if not found calls `getAudioFeatures()` + `insertExternalTrack()`, then queues by URI

**`server/src/database/repositories/track.repo.ts`**

Two new methods:
- `findTrackBySpotifyUri(uri: string): TrackRow | null` — looks up by `spotify_uri` column
- `insertExternalTrack(data: ExternalTrackInsert): TrackRow` — inserts with all available fields; `genre_cluster` = null (filled later by AI inference scheduler)

```typescript
interface ExternalTrackInsert {
  name: string;
  artist: string;
  artistId: string | null;
  album: string | null;
  spotifyUri: string;
  durationMs: number;
  popularity: number;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  loudness: number | null;
}
```

## Graceful Degradation

- Recommendations API returns empty / errors → silent fallback to existing local DB filter for that bucket
- `getAudioFeatures()` fails → track inserted with null feature columns (state vector skips null features, existing pattern)
- `currentTrack` not available (session start) → skip seeding by track/artist; use top-artist seeds only for both buckets

## File Summary

### New files (1)
- `server/src/spotify/recommendations.ts`

### Modified files (4)
- `server/src/ai/prompts.ts`
- `server/src/intelligence/pool-builder.ts`
- `server/src/intelligence/curator.ts`
- `server/src/database/repositories/track.repo.ts`
