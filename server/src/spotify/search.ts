import { spotifyFetch } from './client.js';
import {
  upsertTrack,
  getTrackBySpotifyId,
  type UpsertTrackData,
} from '../database/repositories/track.repo.js';
import { logger } from '../shared/logger.js';
import type { TrackRow } from '../database/types.js';

interface SpotifySearchTrackItem {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album?: { name?: string; images?: { url: string }[] };
  duration_ms: number;
  uri: string;
}

/**
 * Search Spotify for tracks matching a query, upsert results into the local DB,
 * and return full TrackRow objects ready for queue injection.
 */
export async function searchSpotifyAndUpsert(
  query: string,
  limit: number = 10,
): Promise<TrackRow[]> {
  try {
    const encoded = encodeURIComponent(query);
    const data = await spotifyFetch<{
      tracks?: { items: SpotifySearchTrackItem[] };
    }>(`/search?q=${encoded}&type=track&limit=${Math.min(limit, 20)}`);

    if (!data.tracks?.items || data.tracks.items.length === 0) {
      logger.debug({ query }, 'Spotify search returned no results');
      return [];
    }

    const results: TrackRow[] = [];

    for (const item of data.tracks.items) {
      const trackData: UpsertTrackData = {
        spotifyId: item.id,
        name: item.name,
        artist: item.artists.map((a) => a.name).join(', '),
        artistId: item.artists[0]?.id ?? undefined,
        album: item.album?.name,
        albumArtUrl: item.album?.images?.[0]?.url,
        durationMs: item.duration_ms,
        source: 'search',
      };

      upsertTrack(trackData);

      const row = getTrackBySpotifyId(item.id);
      if (row) {
        results.push(row);
      }
    }

    logger.info({ query, found: results.length }, 'Spotify search results upserted');

    return results;
  } catch (err) {
    logger.warn({ err, query }, 'Spotify search failed');
    return [];
  }
}
