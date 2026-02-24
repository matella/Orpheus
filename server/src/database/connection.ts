import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { logger } from '../shared/logger.js';
import { DatabaseError } from '../shared/errors.js';

let db: DatabaseSync | null = null;

/**
 * Initialize and return the SQLite database connection.
 */
export function initDb(): DatabaseSync {
  if (db) return db;

  const dbPath = config.database.path;
  const dbDir = path.dirname(dbPath);

  // Ensure data directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    logger.info({ dir: dbDir }, 'Created database directory');
  }

  try {
    db = new DatabaseSync(dbPath);

    // Enable WAL mode for better read performance
    db.exec('PRAGMA journal_mode = WAL');
    // Enable foreign keys
    db.exec('PRAGMA foreign_keys = ON');
    // Sync mode: NORMAL is safe with WAL and faster than FULL
    db.exec('PRAGMA synchronous = NORMAL');

    logger.info({ path: dbPath }, 'Database connection established');
    return db;
  } catch (error) {
    throw new DatabaseError(`Failed to open database: ${error}`);
  }
}

/**
 * Get the active database connection.
 * Throws if not initialized.
 */
export function getDb(): DatabaseSync {
  if (!db) {
    throw new DatabaseError('Database not initialized. Call initDb() first.');
  }
  return db;
}

/**
 * Close the database connection.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database connection closed');
  }
}
