import { DatabaseSync } from "node:sqlite";
import { databasePath } from "./utils.js";
import { runMigrations } from "./migrations.js";

export const db = new DatabaseSync(databasePath(), { timeout: 5000 });
runMigrations(db);
