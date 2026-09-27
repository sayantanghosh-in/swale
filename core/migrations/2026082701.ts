import type { DatabaseSync } from "node:sqlite";

// v1 — initial schema
export const migrationFunction = (db: DatabaseSync): void => {
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
};
