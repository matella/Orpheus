import cron from 'node-cron';
import { logger } from '../shared/logger.js';
import { isAuthenticated } from '../spotify/auth.js';

interface ScheduledTask {
  name: string;
  schedule: string; // cron expression
  handler: () => Promise<void>;
  runOnStart: boolean;
}

const tasks: ScheduledTask[] = [];
const runningTasks = new Set<string>();

/**
 * Register a task with the scheduler.
 */
export function registerTask(task: ScheduledTask): void {
  tasks.push(task);
  logger.debug({ name: task.name, schedule: task.schedule }, 'Registered scheduled task');
}

/**
 * Start all registered scheduled tasks.
 */
export function startScheduler(): void {
  logger.info({ taskCount: tasks.length }, 'Starting scheduler');

  for (const task of tasks) {
    cron.schedule(task.schedule, async () => {
      await executeTask(task);
    });

    // Run on start if configured (after a short delay to let everything initialize)
    if (task.runOnStart) {
      setTimeout(() => executeTask(task), 2000);
    }
  }
}

async function executeTask(task: ScheduledTask): Promise<void> {
  // Skip if already running (prevent overlap)
  if (runningTasks.has(task.name)) {
    logger.debug({ name: task.name }, 'Task already running, skipping');
    return;
  }

  // Skip if not authenticated
  const auth = isAuthenticated();
  if (!auth.authenticated) {
    logger.debug({ name: task.name }, 'Not authenticated, skipping task');
    return;
  }

  runningTasks.add(task.name);
  const start = Date.now();

  try {
    logger.info({ name: task.name }, 'Running scheduled task');
    await task.handler();
    logger.info({ name: task.name, durationMs: Date.now() - start }, 'Scheduled task complete');
  } catch (error) {
    logger.error({ name: task.name, err: error }, 'Scheduled task failed');
  } finally {
    runningTasks.delete(task.name);
  }
}
