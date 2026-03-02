import { logger } from './shared/logger.js';
import { initDb, closeDb } from './database/connection.js';
import { runMigrations } from './database/migrations.js';
import { startServer } from './api/server.js';
import { registerLibrarySyncTasks } from './scheduler/tasks/sync-library.js';
import { registerPlayerPollTask } from './scheduler/tasks/poll-player.js';
import { registerAnalyticsComputeTask } from './scheduler/tasks/compute-analytics.js';
import { registerMonthlyRecapTask } from './scheduler/tasks/monthly-recap.js';
import { startScheduler } from './scheduler/scheduler.js';
import { engine } from './playback/engine.js';

async function main() {
  logger.info('');
  logger.info('  ORPHEUS -- Autonomous Music Intelligence');
  logger.info('');

  // Initialize database
  const db = initDb();
  runMigrations(db);

  // Start API server
  await startServer();

  // Register and start scheduled tasks
  registerLibrarySyncTasks();
  registerPlayerPollTask();
  registerAnalyticsComputeTask();
  registerMonthlyRecapTask();
  startScheduler();

  logger.info('Orpheus is ready');
}

// Graceful shutdown
function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down Orpheus...');
  engine.stop();
  closeDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start Orpheus');
  process.exit(1);
});
