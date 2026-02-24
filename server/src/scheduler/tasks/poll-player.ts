import { registerTask } from '../scheduler.js';
import { getPlayerState, getDevices } from '../../spotify/player.js';
import { engine } from '../../playback/engine.js';
import { getTrackStats } from '../../database/repositories/track.repo.js';
import { logger } from '../../shared/logger.js';

/**
 * Register the player polling task.
 *
 * Polls Spotify every 30 seconds (when engine is idle) to detect
 * when a device becomes available, then auto-starts the engine.
 *
 * When the engine is running, polling is handled by the engine itself.
 */
export function registerPlayerPollTask(): void {
  registerTask({
    name: 'poll-player',
    schedule: '*/30 * * * * *', // Every 30 seconds (6-field cron for node-cron)
    handler: async () => {
      // Only poll when engine is idle
      if (engine.isRunning()) return;

      // Need tracks in the library to start
      const stats = getTrackStats();
      if (stats.withFeatures === 0) {
        logger.debug('No tracks with features yet, skipping player poll');
        return;
      }

      try {
        const devices = await getDevices();
        const activeDevice = devices.find((d) => d.isActive);

        if (activeDevice) {
          logger.info(
            { device: activeDevice.name, type: activeDevice.type },
            'Active Spotify device detected, starting engine',
          );
          await engine.start(activeDevice.id, activeDevice.name);
        }
      } catch (err) {
        logger.debug({ err }, 'Player poll failed (may not be authenticated)');
      }
    },
    runOnStart: false,
  });
}
