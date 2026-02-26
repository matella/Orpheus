import { registerTask } from '../scheduler.js';
import { getDevices } from '../../spotify/player.js';
import { engine } from '../../playback/engine.js';
import { getTrackStats } from '../../database/repositories/track.repo.js';
import {
  getAutomationSettings,
  isQuietHoursNow,
} from '../../database/repositories/settings.repo.js';
import { sleep } from '../../shared/utils.js';
import { logger } from '../../shared/logger.js';

/**
 * Register the player polling task.
 *
 * Polls Spotify every 30 seconds (when engine is idle) to detect
 * when a device becomes available, then auto-starts the engine.
 *
 * Respects: auto_start_enabled, quiet hours, auto_start_delay.
 * When the engine is running, polling is handled by the engine itself.
 */
export function registerPlayerPollTask(): void {
  registerTask({
    name: 'poll-player',
    schedule: '*/30 * * * * *', // Every 30 seconds (6-field cron for node-cron)
    handler: async () => {
      // Only poll when engine is idle
      if (engine.isRunning()) return;

      // Check if auto-start is enabled
      const settings = getAutomationSettings();
      if (!settings.autoStartEnabled) {
        logger.debug('Auto-start disabled, skipping player poll');
        return;
      }

      // Check quiet hours
      if (isQuietHoursNow()) {
        logger.debug('Quiet hours active, skipping auto-start');
        return;
      }

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
          // Apply auto-start delay
          if (settings.autoStartDelay > 0) {
            logger.info(
              { device: activeDevice.name, delaySec: settings.autoStartDelay },
              'Active device detected, waiting auto-start delay',
            );
            await sleep(settings.autoStartDelay * 1000);

            // Re-check conditions after delay
            if (engine.isRunning()) return;
            if (isQuietHoursNow()) return;

            // Re-verify device is still active
            const refreshedDevices = await getDevices();
            const stillActive = refreshedDevices.find(
              (d) => d.isActive && d.id === activeDevice.id,
            );
            if (!stillActive) {
              logger.debug('Device no longer active after delay, skipping');
              return;
            }
          }

          logger.info(
            { device: activeDevice.name, type: activeDevice.type },
            'Active Spotify device detected, auto-starting engine',
          );
          await engine.start(activeDevice.id, activeDevice.name, true);
        }
      } catch (err) {
        logger.debug({ err }, 'Player poll failed (may not be authenticated)');
      }
    },
    runOnStart: false,
  });
}
