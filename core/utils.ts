// library imports
import type { OAuthAppAuthentication } from "@octokit/auth-oauth-device";
// node imports
import fs, { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
// local imports
import type { PackageJsonContents } from "./models.js";

/**
 * Locates this package's own package.json by walking up from this file's
 * directory. Cannot use process.cwd(): for a globally installed CLI that is
 * whatever directory the user happens to be in, not the install location.
 */
const findPackageJsonPath = (): string | undefined => {
  let dir = import.meta.dirname;

  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) break; // hit the filesystem root
    dir = parent;
  }

  return undefined;
};

export const parsePackageJsonContents = (): PackageJsonContents => {
  const packageJsonFileData: PackageJsonContents = {
    description: "",
    name: "",
    version: "",
  };
  try {
    const packageJsonPath = findPackageJsonPath();
    if (!packageJsonPath) return packageJsonFileData;

    const data = readFileSync(packageJsonPath, "utf8");
    const parsedPackageJson = JSON.parse(data);
    packageJsonFileData["description"] = parsedPackageJson["description"] || "";
    packageJsonFileData["name"] = parsedPackageJson["name"] || "";
    packageJsonFileData["version"] = parsedPackageJson["version"] || "";
  } catch (err) {
    console.error(err);
  }

  return packageJsonFileData;
};

export function resolveDataDir(): string {
  // 1. Explicit override — see below, this is the important one
  const override = process.env.SWALE_DATA_DIR;
  if (override) return path.resolve(override);

  // 2. Windows has a genuine convention; ~/.swale would be unidiomatic there
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "swale");
  }

  // 3. macOS + Linux: the dotfile convention (~/.aws, ~/.docker, ~/.ssh)
  return path.join(os.homedir(), ".swale");
}

export function ensureDataDir(): string {
  const dir = resolveDataDir();
  // recursive:true means no "does it exist?" check — it's a no-op if present.
  // mode 0700 = only this user can read it. Applies at creation; ignored on Windows.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function databasePath(): string {
  return path.join(ensureDataDir(), "data.db");
}

export function configPath(): string {
  return path.join(ensureDataDir(), "config.json");
}

export type SwaleConfig = Record<string, unknown>;

/**
 * Reads config.json. A missing or unreadable file is not an error — it simply
 * means nothing has been configured yet, so an empty object is returned.
 */
export function readConfig(): SwaleConfig {
  try {
    if (!existsSync(configPath())) return {};
    const data = readFileSync(configPath(), "utf-8");
    if (data.trim().length === 0) return {};
    const parsed = JSON.parse(data);
    return parsed !== null && typeof parsed === "object" ? (parsed as SwaleConfig) : {};
  } catch {
    // A corrupted file is treated as absent rather than crashing the CLI.
    return {};
  }
}

function writeConfig(config: SwaleConfig): void {
  const file = configPath();
  // mode only applies when the file is created, so enforce it afterwards too.
  writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows and some filesystems do not support this; the parent dir is 0700.
  }
}

/**
 * Shallow-merges `patch` into the existing config. Top level keys namespace each
 * concern ("github", "llm", ...) so writing one never clobbers another.
 */
export function createOrUpdateConfig(patch: SwaleConfig): void {
  writeConfig({ ...readConfig(), ...patch });
}

/** Removes a single top level key, leaving the rest of the file intact. */
export function removeConfigKey(key: string): void {
  const config = readConfig();
  if (!(key in config)) return;
  delete config[key];
  writeConfig(config);
}

export function getGithubAuth(): OAuthAppAuthentication | undefined {
  const github = readConfig()["github"];
  return github && typeof github === "object" ? (github as OAuthAppAuthentication) : undefined;
}
