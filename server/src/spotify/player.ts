import { spotifyFetch } from './client.js';
import { logger } from '../shared/logger.js';
import { sleep } from '../shared/utils.js';
import type { SpotifyPlayerState, SpotifyDevice } from './types.js';

/**
 * Get the current player state.
 * Returns null if no active player.
 */
export async function getPlayerState(): Promise<SpotifyPlayerState | null> {
  try {
    const data = await spotifyFetch<any>('/me/player');
    if (!data) return null;

    // Skip podcast episodes — Orpheus only manages music tracks
    const item = data.item;
    const isTrack = item && item.type !== 'episode';

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
      track: isTrack
        ? {
            id: item.id,
            uri: item.uri,
            name: item.name,
            artists: (item.artists ?? []).map((a: any) => ({ id: a.id, name: a.name })),
            album: {
              id: item.album?.id ?? '',
              name: item.album?.name ?? '',
              images: item.album?.images ?? [],
            },
            durationMs: item.duration_ms,
          }
        : null,
      shuffleState: data.shuffle_state,
      repeatState: data.repeat_state,
    };
  } catch (error: any) {
    throw error;
  }
}

/**
 * Get available Spotify devices.
 */
export async function getDevices(): Promise<SpotifyDevice[]> {
  const data = await spotifyFetch<{ devices: any[] } | undefined>('/me/player/devices');
  if (!data?.devices) return [];
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
 * Skip to the previous track.
 */
export async function skipToPrevious(): Promise<void> {
  await spotifyFetch('/me/player/previous', { method: 'POST' });
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
 * Get the current Spotify queue.
 */
export async function getQueue(): Promise<{ queue: any[] }> {
  const data = await spotifyFetch<{ queue: any[] }>('/me/player/queue');
  return { queue: data?.queue ?? [] };
}

/**
 * Drain Spotify's user-added queue items by pausing and skipping through them.
 * This ensures Orpheus starts with a clean queue. Best-effort — ignores errors.
 */
export async function drainQueue(): Promise<number> {
  try {
    const { queue } = await getQueue();
    if (queue.length === 0) return 0;

    logger.info({ queuedItems: queue.length }, 'Draining Spotify queue before engine start');

    // Pause so the user doesn't hear rapid skipping
    try { await pause(); } catch { /* might already be paused */ }
    await sleep(200);

    // Skip through queued items (cap at 30 to avoid infinite loop)
    const toSkip = Math.min(queue.length, 30);
    for (let i = 0; i < toSkip; i++) {
      await skipToNext();
      await sleep(150);
    }

    logger.info({ skipped: toSkip }, 'Spotify queue drained');
    return toSkip;
  } catch (err) {
    logger.debug({ err }, 'Could not drain Spotify queue (best-effort)');
    return 0;
  }
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
