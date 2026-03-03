import { getDb } from '../connection.js';
import type { PlaylistRow, PlaylistTrackRow, TrackRow } from '../types.js';

export interface InsertPlaylistData {
  prompt: string;
  name: string | null;
  description: string | null;
  durationMinutes: number;
  discoveryRate: number;
  energyArc: string;
  transitionSmoothness: number;
  maxPerArtist: number;
  seedTrackId: number | null;
  sourcePreference: string;
  spotifyPlaylistId: string | null;
  spotifyPlaylistUrl: string | null;
  trackCount: number;
  totalDurationMs: number;
  generationTimeMs: number | null;
  aiEnhanced: boolean;
}

export interface InsertPlaylistTrackData {
  trackId: number;
  position: number;
  score: number | null;
  segment: number | null;
}

export type PlaylistTrackWithDetails = PlaylistTrackRow & {
  name: string;
  artist: string;
  album: string | null;
  album_art_url: string | null;
  duration_ms: number;
  spotify_id: string;
};

export function insertPlaylistWithTracks(data: InsertPlaylistData, tracks: InsertPlaylistTrackData[]): number {
  const db = getDb();

  db.prepare('SAVEPOINT insert_playlist').run();
  try {
    const result = db.prepare(`
      INSERT INTO playlists (
        prompt, name, description, duration_minutes, discovery_rate,
        energy_arc, transition_smoothness, max_per_artist, seed_track_id,
        source_preference, spotify_playlist_id, spotify_playlist_url,
        track_count, total_duration_ms, generation_time_ms, ai_enhanced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.prompt,
      data.name,
      data.description,
      data.durationMinutes,
      data.discoveryRate,
      data.energyArc,
      data.transitionSmoothness,
      data.maxPerArtist,
      data.seedTrackId,
      data.sourcePreference,
      data.spotifyPlaylistId,
      data.spotifyPlaylistUrl,
      data.trackCount,
      data.totalDurationMs,
      data.generationTimeMs,
      data.aiEnhanced ? 1 : 0,
    );

    const playlistId = Number(result.lastInsertRowid);

    const stmt = db.prepare(`
      INSERT INTO playlist_tracks (playlist_id, track_id, position, score, segment)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const t of tracks) {
      stmt.run(playlistId, t.trackId, t.position, t.score, t.segment);
    }

    db.prepare('RELEASE insert_playlist').run();
    return playlistId;
  } catch (err) {
    db.prepare('ROLLBACK TO insert_playlist').run();
    throw err;
  }
}

export function getPlaylistById(id: number): PlaylistRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as unknown as PlaylistRow | undefined;
}

export function getPlaylistTracks(playlistId: number): PlaylistTrackWithDetails[] {
  const db = getDb();
  return db.prepare(`
    SELECT pt.*, t.name, t.artist, t.album, t.album_art_url, t.duration_ms, t.spotify_id
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position ASC
  `).all(playlistId) as unknown as PlaylistTrackWithDetails[];
}

export function getPlaylists(limit: number, offset: number): PlaylistRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM playlists ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).all(limit, offset) as unknown as PlaylistRow[];
}

export function getPlaylistCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM playlists').get() as unknown as { count: number };
  return row.count;
}

export function deletePlaylist(id: number): void {
  getDb().prepare('DELETE FROM playlists WHERE id = ?').run(id);
}
