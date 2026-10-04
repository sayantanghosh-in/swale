// library imports
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
// local imports
import { COLORS } from "../constants.js";
import { isConfigured } from "../utils.js";
import { createBackup, hasData, readBackupManifest, restoreBackup } from "./main.js";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const executeBackupAction = async (targetDir?: string) => {
  const result = createBackup(targetDir);

  if (!result.success || !result.path) {
    console.error(
      result.error === "NO_DATABASE_TO_BACK_UP"
        ? "There is nothing to back up yet. Run `swale` once to get started."
        : `Backup failed: ${result.error}`,
    );
    process.exit(1);
  }

  const counts = result.manifest?.counts ?? {};
  const summary = Object.entries(counts)
    .filter(([, total]) => total > 0)
    .map(([table, total]) => `${chalk.bold.yellow(total)} ${table}`)
    .join(chalk.gray(", "));

  console.log(chalk.hex(COLORS.ORANGE).bold("\nBackup complete."));
  if (summary) console.log(`  ${summary}`);
  console.log(`  ${chalk.gray("Size:")} ${humanSize(result.size ?? 0)}`);
  console.log(`  ${chalk.gray("Saved to:")} ${chalk.cyanBright(result.path)}\n`);
  console.log(
    chalk.gray("  Your API keys and GitHub token are NOT in this file.\n") +
      chalk.gray("  Restore with: ") +
      chalk.white(`swale restore ${result.path}`),
  );
};

export const executeRestoreAction = async (zipPath: string) => {
  const check = readBackupManifest(zipPath);
  if (!check.success || !check.manifest) {
    const messages: Record<string, string> = {
      BACKUP_FILE_NOT_FOUND: `No file at ${zipPath}`,
      NOT_A_SWALE_BACKUP: "That zip has no swale manifest in it, so it is not a swale backup.",
      BACKUP_MISSING_DATABASE: "That backup has no database inside it.",
      BACKUP_FROM_A_NEWER_SWALE: "That backup was made by a newer swale. Upgrade first.",
      BACKUP_UNREADABLE: "That file could not be read as a zip.",
    };
    console.error(messages[check.error ?? ""] ?? `Restore failed: ${check.error}`);
    process.exit(1);
  }

  const manifest = check.manifest;
  console.log(chalk.hex(COLORS.ORANGE).bold("\nBackup contents:"));
  console.log(`  ${chalk.gray("Created:")} ${new Date(manifest.createdAt).toLocaleString()}`);
  console.log(`  ${chalk.gray("From swale:")} v${manifest.swaleVersion}`);
  if (manifest.user) console.log(`  ${chalk.gray("User:")} ${manifest.user.name}`);
  const counts = Object.entries(manifest.counts ?? {})
    .filter(([, total]) => total > 0)
    .map(([table, total]) => `${total} ${table}`)
    .join(", ");
  if (counts) console.log(`  ${chalk.gray("Holds:")} ${counts}`);

  // A fresh machine has nothing to lose, so it does not get asked.
  if (isConfigured() && hasData()) {
    console.log(
      chalk.yellow(
        "\n⚠  swale is already set up on this machine and has data in it.\n   Restoring replaces that data with the contents of the backup.",
      ),
    );

    if (!process.stdin.isTTY) {
      console.error("\nRefusing to overwrite without confirmation. Run this in a terminal.");
      process.exit(1);
    }

    const proceed = await confirm({
      message: "Overwrite the data currently on this machine?",
      default: false,
    });

    if (!proceed) {
      console.log("Nothing was changed.");
      return;
    }
  }

  const result = restoreBackup(zipPath);
  if (!result.success) {
    console.error(`Restore failed: ${result.error}`);
    process.exit(1);
  }

  console.log(chalk.green.bold("\n✓ Restored."));
  if (result.rolledBackTo) {
    console.log(`  ${chalk.gray("Previous database kept at:")} ${result.rolledBackTo}`);
  }
  console.log(chalk.gray("  Run `swale` to sign in and pick up where you left off.\n"));

  // The connection was closed to swap the file; anything further would be
  // talking to a database that is no longer there.
  process.exit(0);
};
