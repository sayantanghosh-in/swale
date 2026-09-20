import type { DatabaseSync } from "node:sqlite";
import { migrationFunction as function_2026082701 } from "./2026082701.js";
import { migrationFunction as function_2026092001 } from "./2026092001.js";
import { migrationFunction as function_2026092002 } from "./2026092002.js";

/**
 * Index N upgrades the database TO version N+1.
 * APPEND ONLY — never edit an entry that has already run anywhere.
 */
const migrations: Array<(db: DatabaseSync) => void> = [
  // 27 August 2026, migration - 1
  function_2026082701,
  // 20 September 2026, migration - 1
  function_2026092001,
  // 20 September 2026, migration - 2
  function_2026092002,
];

export const runMigrations = (db: DatabaseSync): void => {
  const { user_version } = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  let version = user_version;
  if (version >= migrations.length) return;

  db.exec("PRAGMA foreign_keys = OFF"); // ← outside any transaction
  try {
    while (version < migrations.length) {
      const migration = migrations[version];
      if (!migration) break;

      const next = version + 1;
      db.exec("BEGIN");
      try {
        migration(db);
        const violations = db.prepare("PRAGMA foreign_key_check").all();
        if (violations.length > 0) {
          throw new Error(`FK violations after migration ${next}`);
        }
        db.exec(`PRAGMA user_version = ${next}`);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      version = next;
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
};
