import type { DatabaseSync } from "node:sqlite";

/**
 * Normalises every stored timestamp to ISO 8601 (UTC).
 *
 * Two legacy formats existed before this:
 *   - SQLite CURRENT_TIMESTAMP -> "2026-09-20 15:49:04"  (space separated, UTC)
 *   - JS Date.prototype.toString() -> "Sun Sep 20 2026 21:49:42 GMT+0530 (...)"
 *
 * Neither sorts lexicographically, so ORDER BY and range comparisons on dates
 * were silently wrong. Everything is rewritten as "2026-09-20T15:49:04.000Z".
 */
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const SQLITE_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const toIso = (value: unknown): string | null => {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  if (ISO_PATTERN.test(value)) return null; // already correct, skip the write

  // CURRENT_TIMESTAMP is UTC but carries no zone marker, so add one before parsing
  const candidate = SQLITE_PATTERN.test(value) ? value.replace(" ", "T") + "Z" : value;

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const TABLES: Array<{ table: string; columns: string[] }> = [
  { table: "users", columns: ["created_at", "updated_at"] },
  { table: "connections", columns: ["connected_at", "last_synced_at"] },
  { table: "todos", columns: ["created_at", "updated_at"] },
  { table: "notes", columns: ["created_at", "updated_at"] },
  { table: "expenses", columns: ["created_at", "updated_at"] },
];

export const migrationFunction = (db: DatabaseSync): void => {
  for (const { table, columns } of TABLES) {
    const rows = db.prepare(`SELECT id, ${columns.join(", ")} FROM ${table}`).all() as Array<
      Record<string, unknown>
    >;

    for (const row of rows) {
      const updates: string[] = [];
      const values: string[] = [];

      for (const column of columns) {
        const normalised = toIso(row[column]);
        if (normalised !== null) {
          updates.push(`${column} = ?`);
          values.push(normalised);
        }
      }

      if (updates.length === 0) continue;

      db.prepare(`UPDATE ${table} SET ${updates.join(", ")} WHERE id = ?`).run(
        ...values,
        row["id"] as string,
      );
    }
  }
};
