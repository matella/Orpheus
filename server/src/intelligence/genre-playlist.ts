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
