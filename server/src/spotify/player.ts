import { spotifyFetch } from './client.js';
import type { SpotifyPlayerState, SpotifyDevice } from './types.js';

/**
 * Get the current player state.
 * Returns null if no active player.
 */
export async function getPlayerState(): Promise<SpotifyPlayerState | null> {
  try {
    const data = await spotifyFetch<any>('/me/player');
    if (!data) return null;

    return {
      isPlaying: data.is_playing,
      progressMs: data.progress_ms ?? 0,
      device: data.device
        ? {
            id: data.device.id,
            name: data.device.name,
            type: data.device.type,
            isActive: data.device.is_active,
            volumePercent: data.device.volume_percent,
          }
        : null,
      track: data.item
        ? {
            id: data.item.id,
            uri: data.item.uri,
            name: data.item.name,
            artists: data.item.artists.map((a: any) => ({ id: a.id, name: a.name })),
            album: {
              id: data.item.album.id,
              name: data.item.album.name,
              images: data.item.album.images,
            },
            durationMs: data.item.duration_ms,
          }
        : null,
      shuffleState: data.shuffle_state,
      repeatState: data.repeat_state,
    };
  } catch (error: any) {
    // 204 No Content means no active player
    if (error?.statusCode === 204) return null;
    throw error;
  }
}

/**
 * Get available Spotify devices.
 */
export async function getDevices(): Promise<SpotifyDevice[]> {
  const data = await spotifyFetch<{ devices: any[] }>('/me/player/devices');
  return data.devices.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    isActive: d.is_active,
    volumePercent: d.volume_percent,
  }));
}

/**
 * Start or resume playback of a specific track.
 */
export async function playTrack(uri: string, deviceId?: string): Promise<void> {
  const params = deviceId ? `?device_id=${deviceId}` : '';
  await spotifyFetch(`/me/player/play${params}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [uri] }),
  });
}

/**
 * Add a track to the playback queue.
 */
export async function addToQueue(uri: string, deviceId?: string): Promise<void> {
  const params = new URLSearchParams({ uri });
  if (deviceId) params.set('device_id', deviceId);
  await spotifyFetch(`/me/player/queue?${params.toString()}`, { method: 'POST' });
}

/**
 * Skip to the next track.
 */
export async function skipToNext(): Promise<void> {
  await spotifyFetch('/me/player/next', { method: 'POST' });
}

/**
 * Pause playback.
 */
export async function pause(): Promise<void> {
  await spotifyFetch('/me/player/pause', { method: 'PUT' });
}

/**
 * Resume playback.
 */
export async function resume(): Promise<void> {
  await spotifyFetch('/me/player/play', { method: 'PUT' });
}

/**
 * Transfer playback to a specific device.
 */
export async function transferPlayback(deviceId: string): Promise<void> {
  await spotifyFetch('/me/player', {
    method: 'PUT',
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  });
}
