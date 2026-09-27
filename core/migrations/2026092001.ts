import type { DatabaseSync } from "node:sqlite";

export const migrationFunction = (db: DatabaseSync): void => {
  // users: make name, email, phone, currency nullable
  db.exec(`
    CREATE TABLE users_new (
        id         TEXT PRIMARY KEY,
        name       TEXT,
        email      TEXT,
        phone      TEXT,
        currency   TEXT,
        active     TEXT DEFAULT 'false',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    ) STRICT
  `);

  db.exec(`
    INSERT INTO users_new (id, name, email, phone, currency, created_at, updated_at)
    SELECT id, name, email, phone, currency, created_at, updated_at FROM users
  `);

  db.exec(`DROP TABLE users`);
  db.exec(`ALTER TABLE users_new RENAME TO users`);

  // add a new table called connections that stores the connection configs from various providers
  db.exec(`
        CREATE TABLE IF NOT EXISTS connections (
            id              TEXT PRIMARY KEY,
            provider        TEXT NOT NULL DEFAULT 'github',
            login           TEXT NOT NULL,
            name            TEXT,
            avatar_url      TEXT,
            profile_url     TEXT,
            connected_at    TEXT NOT NULL,
            last_synced_at  TEXT,
            meta            TEXT,
            linked_to       TEXT NOT NULL,

            -- one connection per provider per user
            CONSTRAINT uq_connections_user_provider
            UNIQUE (linked_to, provider),

            -- Foreign Key Constraint
            CONSTRAINT fk_connections_users
            FOREIGN KEY (linked_to)
            REFERENCES users(id)
            ON DELETE CASCADE
            ON UPDATE CASCADE
        ) STRICT
    `);
};
