import type { DatabaseSync } from "node:sqlite";

/**
 * Tables for v1.0.0: who you are, what you asked swale to remember, which
 * folders it can read, cached network results, skill runs and LeetCode
 * revisions.
 *
 * No foreign keys on purpose. Every table is keyed by user id and all of it
 * is disposable — a stale cache row or an orphaned revision is harmless, and
 * the migration runner would otherwise refuse to start on one.
 */
export const migrationFunction = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile (
      user_id    TEXT PRIMARY KEY,
      role       TEXT,
      stack      TEXT,
      goal       TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      text       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repos (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      path       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, path)
    );

    CREATE TABLE IF NOT EXISTS cache (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_runs (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      skill      TEXT NOT NULL,
      period     TEXT NOT NULL,
      data       TEXT,
      commentary TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, skill, period)
    );

    CREATE TABLE IF NOT EXISTS revisions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      slug       TEXT NOT NULL,
      title      TEXT NOT NULL,
      stage      INTEGER NOT NULL DEFAULT 0,
      due        TEXT NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, slug)
    );

    CREATE TABLE IF NOT EXISTS leetcode_snapshots (
      user_id TEXT NOT NULL,
      date    TEXT NOT NULL,
      data    TEXT NOT NULL,
      PRIMARY KEY (user_id, date)
    );
  `);
};
