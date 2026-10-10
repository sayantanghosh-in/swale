// node imports
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
// local imports
import { db } from "../db.js";

const runGit = promisify(execFile);

export type RepoCommit = {
  repo: string;
  date: string;
  subject: string;
};

const expand = (raw: string): string =>
  path.resolve(raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw);

const isRepo = (dir: string): boolean => existsSync(path.join(dir, ".git"));

export const listRepos = (userId: string): string[] => {
  return (
    db.prepare("SELECT path FROM repos WHERE user_id = ? ORDER BY path").all(userId) as {
      path: string;
    }[]
  ).map((row) => row.path);
};

/**
 * Registers a repo, or every repo one level inside a folder like ~/code.
 * Most people keep their projects side by side, so pointing at the parent is
 * the common case and should not mean adding twenty paths by hand.
 */
export const addRepos = (userId: string, raw: string): { added: string[]; error?: string } => {
  const target = expand(raw);
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    return { added: [], error: `No folder at ${target}` };
  }

  const candidates = isRepo(target)
    ? [target]
    : readdirSync(target)
        .map((name) => path.join(target, name))
        .filter((dir) => {
          try {
            return statSync(dir).isDirectory() && isRepo(dir);
          } catch {
            return false;
          }
        });

  if (!candidates.length) return { added: [], error: `No git repositories in ${target}` };

  const insert = db.prepare(
    "INSERT OR IGNORE INTO repos (id, user_id, path, created_at) VALUES (?, ?, ?, ?)",
  );
  const added = candidates.filter(
    (dir) => insert.run(randomUUID(), userId, dir, new Date().toISOString()).changes === 1,
  );
  return { added };
};

export const removeRepo = (userId: string, raw: string): { success: boolean } => {
  const ran = db
    .prepare("DELETE FROM repos WHERE user_id = ? AND (path = ? OR path LIKE ?)")
    .run(userId, expand(raw), `%/${raw}`);
  return { success: ran.changes > 0 };
};

/** Commits by this machine's git user across registered repos, newest first. */
export async function gitLog(
  repos: string[],
  sinceDays: number,
  limitPerRepo = 50,
): Promise<RepoCommit[]> {
  const results = await Promise.all(
    repos.map(async (repo) => {
      try {
        const { stdout } = await runGit(
          "git",
          [
            "-C",
            repo,
            "log",
            `--since=${sinceDays} days ago`,
            `--max-count=${limitPerRepo}`,
            "--all",
            "--no-merges",
            "--format=%cI%x09%s",
          ],
          { timeout: 8000 },
        );
        return stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [date = "", ...subject] = line.split("\t");
            return { repo: path.basename(repo), date, subject: subject.join("\t") };
          });
      } catch {
        return [];
      }
    }),
  );
  return results.flat().sort((a, b) => b.date.localeCompare(a.date));
}

/** Last commit in each repo, for spotting projects that have gone quiet. */
export async function lastCommits(
  repos: string[],
): Promise<{ repo: string; path: string; date: string | null; subject: string }[]> {
  return Promise.all(
    repos.map(async (repo) => {
      try {
        const { stdout } = await runGit("git", ["-C", repo, "log", "-1", "--format=%cI%x09%s"], {
          timeout: 5000,
        });
        const [date = "", ...subject] = stdout.trim().split("\t");
        return {
          repo: path.basename(repo),
          path: repo,
          date: date || null,
          subject: subject.join("\t"),
        };
      } catch {
        return { repo: path.basename(repo), path: repo, date: null, subject: "" };
      }
    }),
  );
}
