import { DatabaseSync } from "node:sqlite";
import { databasePath } from "./utils.js";

export const db = new DatabaseSync(databasePath(), { timeout: 5000 });

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL DEFAULT 0,
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
    status     TEXT NOT NULL DEFAULT todo,
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
    amount      INTEGER NOT NULL DEFAULT 0,
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
