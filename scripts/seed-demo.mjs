/**
 * Resets the demo database used by the VHS recordings.
 *
 * Recordings mutate data — `swale todo add` really does add a todo — so
 * without this a second run shows the first run's leftovers. Run it before
 * every recording so the GIFs are reproducible.
 *
 * Copies your real config (GitHub token, LLM settings) so the integrations
 * work, and your real database for the user and connection rows, then clears
 * and re-seeds the record tables. Your own data is never written to.
 */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEMO_DIR = process.env.SWALE_DEMO_DIR ?? "/tmp/swale-demo";
const REAL_DIR = join(homedir(), ".swale");

for (const file of ["config.json", "data.db"]) {
  if (!existsSync(join(REAL_DIR, file))) {
    console.error(`Missing ${join(REAL_DIR, file)}. Sign in with \`swale gh sync\` first.`);
    process.exit(1);
  }
}

rmSync(DEMO_DIR, { recursive: true, force: true });
mkdirSync(DEMO_DIR, { recursive: true, mode: 0o700 });
copyFileSync(join(REAL_DIR, "config.json"), join(DEMO_DIR, "config.json"));
copyFileSync(join(REAL_DIR, "data.db"), join(DEMO_DIR, "data.db"));
chmodSync(join(DEMO_DIR, "config.json"), 0o600);

const db = new DatabaseSync(join(DEMO_DIR, "data.db"));
const user = db.prepare("SELECT id FROM users WHERE active = 'true'").get();
if (!user) {
  console.error("No active user in the source database.");
  process.exit(1);
}

for (const table of ["todos", "notes", "expenses"]) {
  db.exec(`DELETE FROM ${table}`);
}

const now = Date.now();
const ago = (minutes) => new Date(now - minutes * 60_000).toISOString();

const todo = db.prepare(
  "INSERT INTO todos (id,text,status,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?)",
);
[
  ["Review the auth refresh PR", "in_progress", 41],
  ["Write the eval cases for tool selection", "todo", 183],
].forEach(([text, status, minutes]) =>
  todo.run(randomUUID(), text, status, ago(minutes), ago(minutes), user.id),
);

const note = db.prepare(
  "INSERT INTO notes (id,text,created_at,updated_at,created_by) VALUES (?,?,?,?,?)",
);
[["LangGraph: nodes return dicts, edge functions return string labels", 124]].forEach(
  ([text, minutes]) => note.run(randomUUID(), text, ago(minutes), ago(minutes), user.id),
);

const expense = db.prepare(
  "INSERT INTO expenses (id,description,amount,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?)",
);
[["Runpod GPU hours", 1840, 302]].forEach(([description, amount, minutes]) =>
  expense.run(randomUUID(), description, amount, ago(minutes), ago(minutes), user.id),
);

console.log(`Demo data ready in ${DEMO_DIR}`);
