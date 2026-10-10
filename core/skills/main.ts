// node imports
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
// local imports
import { SKILLS_DIR_NAME, SLASH_COMMANDS } from "../constants.js";
import type { Skill } from "../models.js";
import { ensureDataDir, packageRoot } from "../utils.js";

/*
 * A skill is a recipe in markdown: frontmatter that says what it is and when
 * it runs, and a body that tells the model what to do with the results.
 *
 * Small local models are poor at planning and good at following
 * instructions, so the recipe does the planning. Built-in skills ship inside
 * the package; installed ones live in ~/.swale/skills and win on a name
 * clash, so any built-in can be rewritten without forking swale.
 */

const builtInDir = (): string | null => {
  const root = packageRoot();
  return root ? path.join(root, SKILLS_DIR_NAME) : null;
};

export const installedDir = (): string => {
  const dir = path.join(ensureDataDir(), SKILLS_DIR_NAME);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
};

/** Just enough YAML for frontmatter: `key: value`, quoted strings and `[a, b]` lists. */
const parseFrontmatter = (
  raw: string,
): { meta: Record<string, string | string[]>; body: string } => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { meta: {}, body: raw.trim() };

  const meta: Record<string, string | string[]> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!pair) continue;
    const key = pair[1] ?? "";
    let value = (pair[2] ?? "").trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      continue;
    }
    value = value.replace(/^["']|["']$/g, "");
    meta[key] = value;
  }
  return { meta, body: (match[2] ?? "").trim() };
};

export const parseSkill = (raw: string, file: string, source: Skill["source"]): Skill | null => {
  const { meta, body } = parseFrontmatter(raw);
  const name = String(meta["name"] ?? "")
    .trim()
    .toLowerCase();
  const description = String(meta["description"] ?? "").trim();
  if (!/^[a-z][a-z0-9-]*$/.test(name) || !description) return null;

  const str = (key: string) =>
    typeof meta[key] === "string" && meta[key] ? String(meta[key]) : undefined;
  const tools = Array.isArray(meta["tools"]) ? (meta["tools"] as string[]) : undefined;

  return {
    name,
    description,
    args: str("args"),
    data: str("data"),
    mode: str("mode") === "chat" || !str("data") ? "chat" : "data",
    schedule: str("schedule"),
    group: str("group") ?? (source === "installed" ? "Installed" : "Daily"),
    tools,
    body,
    source,
    path: file,
  };
};

const readDir = (dir: string | null, source: Skill["source"]): Skill[] => {
  if (!dir || !existsSync(dir)) return [];
  const skills: Skill[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, "SKILL.md");
    if (!existsSync(file)) continue;
    try {
      const skill = parseSkill(readFileSync(file, "utf8"), file, source);
      if (skill) skills.push(skill);
    } catch {
      // A broken skill file should cost that skill, not the whole app.
    }
  }
  return skills;
};

export const loadSkills = (): Skill[] => {
  const byName = new Map<string, Skill>();
  for (const skill of readDir(builtInDir(), "built-in")) byName.set(skill.name, skill);
  for (const skill of readDir(installedDir(), "installed")) byName.set(skill.name, skill);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const findSkill = (name: string): Skill | undefined =>
  loadSkills().find((skill) => skill.name === name.replace(/^\//, "").toLowerCase());

/** Accepts a repo, a folder in a repo, a SKILL.md page on GitHub, or a raw URL. */
const candidateUrls = (url: string): string[] => {
  const trimmed = url.trim().replace(/\/$/, "");
  if (trimmed.startsWith("https://raw.githubusercontent.com/")) return [trimmed];

  const blob = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree)\/([^/]+)\/?(.*)$/.exec(
    trimmed,
  );
  if (blob) {
    const [, owner, repo, branch, rest = ""] = blob;
    const file = rest.endsWith(".md") ? rest : [rest, "SKILL.md"].filter(Boolean).join("/");
    return [`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file}`];
  }

  const bare = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(trimmed);
  if (bare) {
    const [, owner, repo] = bare;
    return ["main", "master"].map(
      (branch) => `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/SKILL.md`,
    );
  }

  return trimmed.startsWith("https://") ? [trimmed] : [];
};

export async function installSkill(url: string): Promise<{ skill?: Skill; error?: string }> {
  const urls = candidateUrls(url);
  if (!urls.length) return { error: "Give a GitHub URL or a raw https link to a SKILL.md." };

  for (const candidate of urls) {
    try {
      const response = await fetch(candidate, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) continue;
      const raw = await response.text();
      const skill = parseSkill(raw, "", "installed");
      if (!skill) return { error: "That file has no valid `name` and `description` frontmatter." };
      if (SLASH_COMMANDS.some((command) => command.name === `/${skill.name}`)) {
        return { error: `/${skill.name} is a built-in command and cannot be replaced.` };
      }

      const dir = path.join(installedDir(), skill.name);
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "SKILL.md");
      writeFileSync(file, raw);
      return { skill: { ...skill, path: file } };
    } catch {
      // Try the next candidate.
    }
  }
  return { error: `Could not fetch a SKILL.md from ${url}` };
}

export const removeSkill = (name: string): { success: boolean; error?: string } => {
  const dir = path.join(installedDir(), name.toLowerCase());
  if (!existsSync(dir)) {
    const builtIn = findSkill(name)?.source === "built-in";
    return {
      success: false,
      error: builtIn
        ? `${name} is built in and cannot be removed.`
        : `No installed skill called ${name}.`,
    };
  }
  rmSync(dir, { recursive: true, force: true });
  return { success: true };
};
