import type { FastifyInstance } from 'fastify';
import {
  getAutomationSettings,
  setSettings,
  SETTING_KEYS,
} from '../../database/repositories/settings.repo.js';

/**
 * Automation settings endpoints.
 *
 * GET  / — returns current automation settings
 * PUT  / — update automation settings (partial update supported)
 */
export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/settings
   * Get current automation settings.
   */
  fastify.get('/', async () => {
    return getAutomationSettings();
  });

  /**
   * PUT /api/settings
   * Update automation settings. Accepts a partial update.
   * Values are validated and clamped to valid ranges.
   */
  fastify.put('/', async (request) => {
    const body = request.body as Partial<{
      autoStartEnabled: boolean;
      autoStartDelay: number;
      quietHoursStart: number;
      quietHoursEnd: number;
    }>;

    const updates: Record<string, string> = {};

    if (typeof body.autoStartEnabled === 'boolean') {
      updates[SETTING_KEYS.AUTO_START_ENABLED] = String(body.autoStartEnabled);
    }
    if (typeof body.autoStartDelay === 'number') {
      const clamped = Math.max(0, Math.min(60, Math.round(body.autoStartDelay)));
      updates[SETTING_KEYS.AUTO_START_DELAY] = String(clamped);
    }
    if (typeof body.quietHoursStart === 'number') {
      const clamped = Math.max(0, Math.min(23, Math.round(body.quietHoursStart)));
      updates[SETTING_KEYS.QUIET_HOURS_START] = String(clamped);
    }
    if (typeof body.quietHoursEnd === 'number') {
      const clamped = Math.max(0, Math.min(23, Math.round(body.quietHoursEnd)));
      updates[SETTING_KEYS.QUIET_HOURS_END] = String(clamped);
    }

    if (Object.keys(updates).length > 0) {
      setSettings(updates);
    }

    return { success: true, settings: getAutomationSettings() };
  });
}
