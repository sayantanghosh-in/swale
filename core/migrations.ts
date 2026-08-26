import type { DatabaseSync } from "node:sqlite";

/**
 * Index N upgrades the database TO version N+1.
 * APPEND ONLY — never edit an entry that has already run anywhere.
 */
const migrations: Array<(db: DatabaseSync) => void> = [
  // v1 — initial schema
  (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            email      TEXT NOT NULL,
            phone      TEXT NOT NULL,
            currency   TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        ) STRICT
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS todos (
            id         TEXT PRIMARY KEY,
            text       TEXT NOT NULL,
            status     TEXT NOT NULL DEFAULT 'todo',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            created_by TEXT NOT NULL,

            -- Foreign Key Constraint
            CONSTRAINT fk_todos_users
            FOREIGN KEY (created_by) 
            REFERENCES users(id) 
            ON DELETE CASCADE 
            ON UPDATE CASCADE
        ) STRICT
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS expenses (
            id          TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            amount      INTEGER NOT NULL,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            created_by TEXT NOT NULL,
            
            -- Foreign Key Constraint
            CONSTRAINT fk_expenses_users
            FOREIGN KEY (created_by) 
            REFERENCES users(id) 
            ON DELETE CASCADE 
            ON UPDATE CASCADE
        ) STRICT
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
            id         TEXT PRIMARY KEY,
            text       TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            created_by TEXT NOT NULL,
            
            -- Foreign Key Constraint
            CONSTRAINT fk_notes_users
            FOREIGN KEY (created_by) 
            REFERENCES users(id) 
            ON DELETE CASCADE 
            ON UPDATE CASCADE
        ) STRICT
    `);
  },
];

export const runMigrations = (db: DatabaseSync): void => {
  const { user_version } = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  let version = user_version;

  while (version < migrations.length) {
    const migration = migrations[version];
    if (!migration) break; // satisfies noUncheckedIndexedAccess

    const next = version + 1;
    db.exec("BEGIN");
    try {
      migration(db);
      db.exec(`PRAGMA user_version = ${next}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    version = next;
  }
};
