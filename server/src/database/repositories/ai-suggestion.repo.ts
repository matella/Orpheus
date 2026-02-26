import { getDb } from '../connection.js';
import type { AiSuggestionRow } from '../types.js';

/**
 * Insert a new AI suggestion.
 */
export function insertAiSuggestion(data: {
  sessionId: number | null;
  suggestionType: string;
  prompt: string;
  response: string;
  applied?: boolean;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO ai_suggestions (session_id, suggestion_type, prompt, response, applied)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    data.sessionId,
    data.suggestionType,
    data.prompt,
    data.response,
    data.applied ? 1 : 0,
  );

  return Number(result.lastInsertRowid);
}

/**
 * Get recent AI suggestions, optionally filtered by session.
 */
export function getAiSuggestions(sessionId?: number, limit: number = 20): AiSuggestionRow[] {
  const db = getDb();

  if (sessionId !== undefined) {
    return db.prepare(
      'SELECT * FROM ai_suggestions WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(sessionId, limit) as AiSuggestionRow[];
  }

  return db.prepare(
    'SELECT * FROM ai_suggestions ORDER BY created_at DESC LIMIT ?',
  ).all(limit) as AiSuggestionRow[];
}

/**
 * Get the most recent suggestion of a given type for a session.
 */
export function getLatestSuggestion(
  sessionId: number,
  suggestionType: string,
): AiSuggestionRow | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM ai_suggestions WHERE session_id = ? AND suggestion_type = ? ORDER BY created_at DESC LIMIT 1',
  ).get(sessionId, suggestionType) as AiSuggestionRow | undefined;
  return row ?? null;
}

/**
 * Mark a suggestion as applied.
 */
export function markSuggestionApplied(id: number): void {
  const db = getDb();
  db.prepare('UPDATE ai_suggestions SET applied = 1 WHERE id = ?').run(id);
}
