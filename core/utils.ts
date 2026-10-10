// library imports
import type { OAuthAppAuthentication } from "@octokit/auth-oauth-device";
import { input, password, select } from "@inquirer/prompts";
import { type LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
// node imports
import fs, { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
// local imports
import type { CalendarDay, CalendarStats, LLMConfig, PackageJsonContents } from "./models.js";
import { BACKUP_DIR_NAME, LOCAL_CONTEXT_TOKENS } from "./constants.js";

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

/** The installed package's own folder — where the built-in skills ship. */
export const packageRoot = (): string | undefined => {
  const file = findPackageJsonPath();
  return file ? path.dirname(file) : undefined;
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

export function backupDir(): string {
  const dir = path.join(ensureDataDir(), BACKUP_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** True once onboarding has stored a GitHub token. */
export function isConfigured(): boolean {
  return Boolean(getGithubAuth()?.token);
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

export function getLlmDetails(): LLMConfig | undefined {
  const llm = readConfig()?.["llm"];
  return llm && typeof llm === "object" ? (llm as LLMConfig) : undefined;
}

/**
 * Puts text on the system clipboard.
 *
 * Shells out to the platform tool rather than using an OSC 52 escape: OSC 52
 * is silently dropped or truncated by several terminals, and failing quietly
 * is the one thing a copy must not do.
 */
export function copyToClipboard(text: string): boolean {
  const candidates: [string, string[]][] =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "win32"
        ? [["clip", []]]
        : [
            ["wl-copy", []],
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--input"]],
          ];

  for (const [command, args] of candidates) {
    const result = spawnSync(command, args, { input: text });
    if (result.status === 0) return true;
  }
  return false;
}

/** Swaps just the model, leaving the provider and credentials untouched. */
export function setLlmModel(model: string): boolean {
  const llm = getLlmDetails();
  if (!llm) return false;
  createOrUpdateConfig({ llm: { ...llm, model } });
  return true;
}

/** How the current model is labelled in the UI: where it runs, and which one. */
export function describeLlm(llm: LLMConfig | undefined): { provider: string; model: string } {
  if (!llm) return { provider: "no model", model: "run /model" };
  if (llm.type === "local") {
    return { provider: llm.baseUrl.replace(/^https?:\/\//, ""), model: llm.model };
  }
  return { provider: llm.provider ?? "remote", model: llm.model };
}

export async function askForLLMDetails(): Promise<{ success: boolean }> {
  try {
    let selectedLlmType = (await select({
      message: "Choose LLM Type?",
      choices: ["Local", "Remote"]?.map((u) => {
        return {
          name: u,
          value: u?.toLowerCase(),
        };
      }),
    })) as string;

    if (selectedLlmType === "local") {
      // ask for local LLM details and store it in the local config and not in the database
      const baseUrl = await input({
        message: "Local LLM base URL:",
        default: "http://localhost:11434",
      });

      const model = await input({
        message: "Local model name:",
        default: "llama3",
      });

      createOrUpdateConfig({
        llm: {
          type: "local",
          baseUrl,
          model,
          provider: null,
          apiKey: null,
        },
      });
    } else {
      // ask for remote LLM details and store it in the local config and not in the database
      const provider = (await select({
        message: "Choose remote provider?",
        choices: ["OpenAI", "Anthropic", "Groq", "Other"].map((p) => ({
          name: p,
          value: p.toLowerCase(),
        })),
      })) as string;

      const apiKey = await password({
        message: `${provider} API key:`,
        mask: "*",
      });

      const model = await input({
        message: "Model name:",
      });

      let baseUrl: string | undefined;
      if (provider === "other") {
        baseUrl = await input({
          message: "Custom base URL:",
        });
      }

      createOrUpdateConfig({
        llm: {
          type: "remote",
          provider,
          apiKey,
          baseUrl,
          model,
        },
      });
    }
    return {
      success: true,
    };
  } catch (e) {
    return {
      success: false,
    };
  }
}

/** Per-provider call options. Only local models need any today: the context window. */
export function llmProviderOptions(
  llm: LLMConfig,
): Record<string, Record<string, any>> | undefined {
  if (llm.type !== "local") return undefined;
  return { ollama: { options: { num_ctx: llm.numCtx ?? LOCAL_CONTEXT_TOKENS } } };
}

export function resolveModel(llm: LLMConfig): LanguageModel {
  if (llm.type === "local") {
    const ollama = createOllama({
      baseURL: llm.baseUrl.endsWith("/api") ? llm.baseUrl : `${llm.baseUrl}/api`,
    });
    return ollama(llm.model);
  }

  switch (llm.provider) {
    case "openai": {
      // Genuine OpenAI — keep using the official provider, it needs /v1/responses
      const openai = createOpenAI({
        apiKey: llm.apiKey,
        ...(llm.baseUrl ? { baseURL: llm.baseUrl } : {}),
      });
      return openai(llm.model);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: llm.apiKey,
        ...(llm.baseUrl ? { baseURL: llm.baseUrl } : {}),
      });
      return anthropic(llm.model);
    }
    case "groq": {
      // Groq only implements /v1/chat/completions — use the compatible provider
      const groq = createOpenAICompatible({
        name: "groq",
        apiKey: llm.apiKey,
        baseURL: llm.baseUrl ?? "https://api.groq.com/openai/v1",
      });
      return groq(llm.model);
    }
    case "other": {
      if (!llm.baseUrl) {
        throw new Error("Custom provider requires a baseUrl");
      }
      // Any third-party OpenAI-compatible endpoint (NVIDIA NIM, etc.)
      const custom = createOpenAICompatible({
        name: "custom",
        apiKey: llm.apiKey,
        baseURL: llm.baseUrl,
      });
      return custom(llm.model);
    }
    default:
      throw new Error(`Unsupported provider: ${llm.provider}`);
  }
}

/* --------------------------------------------------------------------------
 * Contribution calendars
 * ----------------------------------------------------------------------- */

/** Local YYYY-MM-DD. toISOString() would shift the day for anyone east of UTC. */
export function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** LeetCode returns { unixSeconds: count }. GitHub already gives dates. */
export function leetcodeCalendarToDays(calendar: Record<string, number>): CalendarDay[] {
  return Object.entries(calendar ?? {})
    .map(([seconds, count]) => ({
      date: toDateKey(new Date(Number(seconds) * 1000)),
      count: Number(count) || 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Pads a sparse series out to one entry per day, ending today. Both sources
 * omit empty days, and a calendar with holes in it draws wrong.
 */
export function fillCalendarWindow(days: CalendarDay[], totalDays: number): CalendarDay[] {
  const counts = new Map(days.map((day) => [day.date, day.count]));
  const filled: CalendarDay[] = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0); // midday, so DST never rolls the date back

  for (let i = totalDays - 1; i >= 0; i--) {
    const day = new Date(cursor);
    day.setDate(day.getDate() - i);
    const key = toDateKey(day);
    filled.push({ date: key, count: counts.get(key) ?? 0 });
  }

  return filled;
}

export function calendarStats(days: CalendarDay[]): CalendarStats {
  let total = 0;
  let activeDays = 0;
  let longestStreak = 0;
  let running = 0;
  let best: CalendarDay | null = null;

  for (const day of days) {
    total += day.count;
    if (day.count > 0) {
      activeDays += 1;
      running += 1;
      if (running > longestStreak) longestStreak = running;
      if (!best || day.count > best.count) best = day;
    } else {
      running = 0;
    }
  }

  // Today not being done yet is not a broken streak, so start from yesterday
  // when today is empty.
  let currentStreak = 0;
  let index = days.length - 1;
  if (index >= 0 && days[index]?.count === 0) index -= 1;
  for (; index >= 0; index--) {
    if ((days[index]?.count ?? 0) === 0) break;
    currentStreak += 1;
  }

  return { total, activeDays, currentStreak, longestStreak, best };
}

/** Buckets a day into the 0-4 heat levels, scaled to this person's own busiest day. */
export function heatLevel(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  const ratio = count / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/** Opens a URL in the default browser without waiting for it. */
export function openInBrowser(url: string): boolean {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(command as string, args as string[], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

/** Whole days between an ISO date and now. */
export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
