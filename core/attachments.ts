// node imports
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
// local imports
import { ATTACHMENT_KINDS, MAX_ATTACHMENT_BYTES, MAX_PASTED_PATH_LENGTH } from "./constants.js";
import type { Attachment } from "./models.js";

/**
 * Turns a shell-style path into a real one.
 *
 * Dragging a file into a terminal, or copying one in Finder and pasting, does
 * not hand over a clean path: it arrives quoted, or with every space escaped as
 * "\\ ", or prefixed with file://. All three mean the same file.
 */
function normalisePath(raw: string): string {
  let value = raw.trim();
  if (!value) return "";

  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {
      return "";
    }
  }

  const quoted = /^(['"])(.*)\1$/.exec(value);
  if (quoted?.[2] !== undefined) {
    value = quoted[2];
  } else {
    value = value.replace(/\\ /g, " ");
  }

  if (value.startsWith("~")) value = path.join(os.homedir(), value.slice(1));

  return path.resolve(value);
}

function classify(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return { ext, ...(ATTACHMENT_KINDS[ext] ?? { kind: "file", icon: "📎" }) };
}

export function describeAttachment(filePath: string): Attachment | null {
  const resolved = normalisePath(filePath);
  if (!resolved || !existsSync(resolved)) return null;

  const stats = statSync(resolved);
  if (!stats.isFile() || stats.size > MAX_ATTACHMENT_BYTES) return null;

  const { ext, kind, icon } = classify(resolved);
  return {
    id: randomUUID(),
    path: resolved,
    name: path.basename(resolved),
    ext,
    kind,
    icon,
    bytes: stats.size,
    // No readers yet. Deliberately honest rather than defaulting to true.
    readable: false,
  };
}

/**
 * Reads a pasted blob and decides whether it is files or prose.
 *
 * Tries the whole string first, because a single path may contain spaces and
 * splitting it would turn one real file into several imaginary ones. Only if
 * that misses does it fall back to treating each line as its own path.
 */
export function parsePastedAttachments(text: string): {
  attachments: Attachment[];
  remainder: string;
} {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_PASTED_PATH_LENGTH) {
    return { attachments: [], remainder: text };
  }

  const whole = describeAttachment(trimmed);
  if (whole) return { attachments: [whole], remainder: "" };

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > 1) {
    const found: Attachment[] = [];
    const leftover: string[] = [];
    for (const line of lines) {
      const attachment = describeAttachment(line);
      if (attachment) found.push(attachment);
      else leftover.push(line);
    }
    if (found.length) return { attachments: found, remainder: leftover.join("\n") };
  }

  return { attachments: [], remainder: text };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
