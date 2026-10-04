// library imports
import AdmZip from "adm-zip";
// node imports
import { existsSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
// local imports
import { db } from "../db.js";
import type { BackupManifest } from "../models.js";
import { BACKUP_DB_NAME, BACKUP_FORMAT_VERSION, BACKUP_MANIFEST_NAME } from "../constants.js";
import { backupDir, databasePath, parsePackageJsonContents } from "../utils.js";
import { getActiveUser } from "../users/main.js";

const COUNTED_TABLES = ["users", "connections", "todos", "notes", "expenses"];

export function countRows(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
      counts[table] = row?.total ?? 0;
    } catch {
      counts[table] = 0;
    }
  }
  return counts;
}

/** True when there is anything worth warning about before an overwrite. */
export function hasData(): boolean {
  return Object.values(countRows()).some((count) => count > 0);
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

/**
 * Writes a zip holding the database and a manifest.
 *
 * config.json is deliberately left out — it holds the GitHub token and any LLM
 * API key, and all of it comes back by re-running onboarding.
 */
export function createBackup(targetDir?: string): {
  success: boolean;
  path?: string;
  size?: number;
  manifest?: BackupManifest;
  error?: string;
} {
  const source = databasePath();
  if (!existsSync(source)) {
    return { success: false, error: "NO_DATABASE_TO_BACK_UP" };
  }

  // Copying the file directly can catch a half-written page. VACUUM INTO asks
  // SQLite itself for a consistent snapshot while the connection stays open.
  const staging = mkdtempSync(path.join(os.tmpdir(), "swale-backup-"));
  const snapshot = path.join(staging, BACKUP_DB_NAME);

  try {
    db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);

    const user = getActiveUser();
    const manifest: BackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      swaleVersion: parsePackageJsonContents().version,
      createdAt: new Date().toISOString(),
      user: user ? { name: user.name, email: user.email } : null,
      counts: countRows(),
    };

    const zip = new AdmZip();
    zip.addLocalFile(snapshot);
    zip.addFile(BACKUP_MANIFEST_NAME, Buffer.from(JSON.stringify(manifest, null, 2)));

    const destination = path.join(
      targetDir ? path.resolve(targetDir) : backupDir(),
      `swale-backup-${timestamp()}.zip`,
    );
    zip.writeZip(destination);

    return { success: true, path: destination, size: statSync(destination).size, manifest };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Reads the manifest without unpacking anything, so restore can look before it leaps. */
export function readBackupManifest(zipPath: string): {
  success: boolean;
  manifest?: BackupManifest;
  error?: string;
} {
  const resolved = path.resolve(zipPath);
  if (!existsSync(resolved)) {
    return { success: false, error: "BACKUP_FILE_NOT_FOUND" };
  }

  try {
    const zip = new AdmZip(resolved);
    const entry = zip.getEntry(BACKUP_MANIFEST_NAME);
    if (!entry) {
      return { success: false, error: "NOT_A_SWALE_BACKUP" };
    }
    if (!zip.getEntry(BACKUP_DB_NAME)) {
      return { success: false, error: "BACKUP_MISSING_DATABASE" };
    }

    const manifest = JSON.parse(entry.getData().toString("utf8")) as BackupManifest;
    if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
      return { success: false, error: "BACKUP_FROM_A_NEWER_SWALE" };
    }

    return { success: true, manifest };
  } catch {
    return { success: false, error: "BACKUP_UNREADABLE" };
  }
}

/**
 * Replaces the live database with the one in the zip. The current file is kept
 * alongside as .pre-restore so a bad archive is not a dead end.
 *
 * Closes the connection first: overwriting the file under an open handle leaves
 * SQLite reading pages that no longer exist.
 */
export function restoreBackup(zipPath: string): {
  success: boolean;
  rolledBackTo?: string;
  error?: string;
} {
  const check = readBackupManifest(zipPath);
  if (!check.success) {
    return { success: false, error: check.error };
  }

  const target = databasePath();
  const sidelined = `${target}.pre-restore`;

  try {
    const zip = new AdmZip(path.resolve(zipPath));
    const incoming = zip.getEntry(BACKUP_DB_NAME)?.getData();
    if (!incoming?.length) {
      return { success: false, error: "BACKUP_MISSING_DATABASE" };
    }

    // Worth keeping only if it held something; a fresh install has just
    // created an empty one at import time.
    const hadData = hasData();
    db.close();

    if (existsSync(target)) {
      rmSync(sidelined, { force: true });
      // Rename rather than copy: instant, and it cannot half-finish.
      renameSync(target, sidelined);
      writeFileSync(target, incoming, { mode: 0o600 });
      // SQLite's sidecar files belong to the database we just replaced.
      for (const suffix of ["-wal", "-shm"]) {
        rmSync(`${target}${suffix}`, { force: true });
      }
      return { success: true, rolledBackTo: hadData ? sidelined : undefined };
    }

    writeFileSync(target, incoming, { mode: 0o600 });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
