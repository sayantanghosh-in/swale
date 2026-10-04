// node imports
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
// local imports
import { CLIPBOARD_IMAGE_TYPES } from "./constants.js";

/*
 * Reading an image out of the system clipboard.
 *
 * A terminal cannot do this for us. Pressing Cmd+V with a screenshot on the
 * clipboard sends nothing to stdin — the terminal has no way to put image
 * bytes into a stream of keystrokes. So swale asks the operating system
 * directly, writes the bytes to a temp file, and attaches the file.
 */

const exec = promisify(execFile);

/*
 * Asynchronous, and it has to be.
 *
 * The synchronous version read better and froze the UI. Repeated osascript
 * calls cost around a second each once the AppleScript runtime is contended,
 * and a synchronous spawn holds the event loop for every millisecond of that
 * — so typing stuttered and the streamed reply arrived in lurches, once per
 * polling interval, like clockwork.
 */
async function run(command: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await exec(command, args, { timeout: 5000, encoding: "utf8" });
    return { ok: true, stdout: stdout ?? "" };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/** The clipboard's declared flavours, used to spot an image without reading it. */
export async function clipboardImageType(): Promise<string | null> {
  if (process.platform === "darwin") {
    const { ok, stdout } = await run("osascript", ["-e", "clipboard info"]);
    if (!ok) return null;
    for (const [marker, label] of Object.entries(CLIPBOARD_IMAGE_TYPES)) {
      if (stdout.includes(marker)) return label;
    }
    return null;
  }

  if (process.platform === "linux") {
    const wayland = await run("wl-paste", ["--list-types"]);
    const source = wayland.ok
      ? wayland.stdout
      : (await run("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"])).stdout;
    if (source.includes("image/png")) return "png";
    if (source.includes("image/jpeg")) return "jpeg";
    return null;
  }

  return null;
}

function scratchDir(): string {
  const dir = path.join(os.tmpdir(), "swale-clipboard");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Writes whatever image is on the clipboard to a file and returns its path.
 *
 * Always as PNG: every platform can produce one, and the alternative is
 * guessing which of the ten flavours macOS advertises is the original.
 */
export async function saveClipboardImage(): Promise<string | null> {
  if (!(await clipboardImageType())) return null;

  const destination = path.join(scratchDir(), `pasted-${Date.now()}.png`);

  if (process.platform === "darwin") {
    const { ok } = await run("osascript", [
      "-e",
      "set theData to the clipboard as «class PNGf»",
      "-e",
      `set theFile to open for access (POSIX file "${destination}") with write permission`,
      "-e",
      "set eof theFile to 0",
      "-e",
      "write theData to theFile",
      "-e",
      "close access theFile",
    ]);
    if (!ok) return null;
  } else if (process.platform === "linux") {
    const wayland = await run("sh", ["-c", `wl-paste --type image/png > "${destination}"`]);
    if (!wayland.ok) {
      const x11 = await run("sh", [
        "-c",
        `xclip -selection clipboard -t image/png -o > "${destination}"`,
      ]);
      if (!x11.ok) return null;
    }
  } else {
    return null;
  }

  // An empty file means the write silently failed; treat it as no image.
  if (!existsSync(destination) || statSync(destination).size === 0) return null;
  return destination;
}
