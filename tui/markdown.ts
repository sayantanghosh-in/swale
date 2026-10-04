// library imports
import chalk from "chalk";
// local imports
import { COLORS } from "../core/constants.js";

/*
 * A small markdown renderer for the terminal.
 *
 * Models answer in markdown whether or not you ask them to, and printed raw it
 * reads as "**swale**: a local-first..." — the formatting characters become
 * noise. This converts the subset that actually turns up in chat replies and
 * leaves everything else alone.
 *
 * Line-based on purpose: a real parser would build a tree, but output here is
 * streamed and reflowed, and a tree buys nothing a line loop does not.
 */

/** Inline spans. Code first, so `**` inside backticks is left as written. */
function renderInline(text: string): string {
  const slots: string[] = [];

  let out = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    slots.push(chalk.hex(COLORS.ORANGE)(code));
    return `\u0000${slots.length - 1}\u0000`;
  });

  /*
   * Links first. Every chalk colour is an escape sequence containing a literal
   * "[", so once styling has been applied the link pattern starts matching
   * halfway into an escape code and shreds the line.
   */
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label: string, url: string) => `${chalk.cyan.underline(label)} ${chalk.gray(url)}`,
  );

  out = out
    .replace(/\*\*\*([^*]+)\*\*\*/g, (_m, inner: string) => chalk.bold.italic(inner))
    .replace(/\*\*([^*]+)\*\*/g, (_m, inner: string) => chalk.bold(inner))
    .replace(
      /(^|[^*])\*([^*\n]+)\*/g,
      (_m, before: string, inner: string) => `${before}${chalk.italic(inner)}`,
    )
    .replace(/~~([^~]+)~~/g, (_m, inner: string) => chalk.strikethrough(inner));

  return out.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => slots[Number(index)] ?? "");
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  let inFence = false;
  let fenceLang = "";

  for (const line of lines) {
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      if (inFence) {
        inFence = false;
        fenceLang = "";
      } else {
        inFence = true;
        fenceLang = fence[1] ?? "";
        if (fenceLang) out.push(chalk.gray(`  ┌ ${fenceLang}`));
        else out.push(chalk.gray("  ┌"));
      }
      continue;
    }

    if (inFence) {
      out.push(chalk.gray("  │ ") + chalk.hex("#9CDCFE")(line));
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      out.push(chalk.gray("  " + "─".repeat(30)));
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const depth = heading[1]?.length ?? 1;
      const body = renderInline(heading[2] ?? "");
      out.push(depth <= 2 ? chalk.bold.hex(COLORS.ORANGE)(body) : chalk.bold(body));
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      out.push(chalk.gray("  ▏") + chalk.italic.gray(renderInline(quote[1] ?? "")));
      continue;
    }

    // Keep the author's indentation so nested lists stay nested.
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const indent = bullet[1] ?? "";
      out.push(`${indent}  ${chalk.hex(COLORS.ORANGE)("•")} ${renderInline(bullet[2] ?? "")}`);
      continue;
    }

    const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      const indent = numbered[1] ?? "";
      out.push(
        `${indent}  ${chalk.hex(COLORS.ORANGE)(`${numbered[2]}.`)} ${renderInline(numbered[3] ?? "")}`,
      );
      continue;
    }

    out.push(renderInline(line));
  }

  // An unterminated fence is normal mid-stream; close it so the box is not left open.
  if (inFence) out.push(chalk.gray("  └"));

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/**
 * Splits streaming markdown into a part that is safe to print now and a tail
 * that is still arriving.
 *
 * Ink repaints its whole live frame on every change, so letting a long answer
 * accumulate there means erasing and redrawing thirty lines several times a
 * second — which is what made streamed replies stutter. Finished paragraphs
 * are handed to <Static> instead and never touched again.
 *
 * The boundary is a blank line outside a code fence. Splitting inside a fence
 * would render half a code block with no closing line, so fence depth is
 * tracked and the cut only happens between blocks.
 */
export function splitCommittable(text: string, maxPendingLines = 14): [string, string] {
  const lines = text.split("\n");
  if (lines.length < 2) return ["", text];

  let inFence = false;
  let boundary = -1;
  let lastSafeLine = -1;

  // Never consider the final line: it may be half a sentence.
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    lastSafeLine = i;
    if (line.trim() === "") boundary = i;
  }

  // The blank line is the separator and is dropped; a fallback cut is between
  // two real lines, so both have to be kept.
  if (boundary >= 0) {
    return [lines.slice(0, boundary).join("\n"), lines.slice(boundary + 1).join("\n")];
  }

  // A long answer with no blank line in it would otherwise never commit, so
  // fall back to cutting after the last complete line outside a fence.
  if (lines.length - 1 > maxPendingLines && lastSafeLine > 0) {
    return [lines.slice(0, lastSafeLine + 1).join("\n"), lines.slice(lastSafeLine + 1).join("\n")];
  }

  return ["", text];
}
