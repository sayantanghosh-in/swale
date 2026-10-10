// local imports
import { db } from "../db.js";

/**
 * A tiny key/value cache in the same SQLite file.
 *
 * Its main job is the instant dashboard: draw from the last saved result,
 * then refresh behind it. Waiting five seconds on GitHub and LeetCode every
 * time you open swale was the slowest thing about it.
 */
export function readCache<T>(key: string): { value: T; updatedAt: string } | null {
  const row = db.prepare("SELECT value, updated_at FROM cache WHERE key = ?").get(key) as
    { value: string; updated_at: string } | undefined;
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value) as T, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), new Date().toISOString());
}
