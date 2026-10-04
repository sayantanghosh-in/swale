// library imports
import chalk from "chalk";
// local imports
import { COLORS } from "../core/constants.js";

/*
 * The mark: a swale in cross-section.
 *
 * A swale is a shallow planted channel that catches rain where it falls and
 * lets it soak in, instead of letting it run off. So the drawing is exactly
 * that and nothing else — ground sloping in from both sides, grass on the
 * banks, rain coming down, water held in the dip. No face, no creature.
 */

const GROUND = chalk.hex(COLORS.ORANGE);
const GRASS = chalk.hex("#4FA355");
const WATER = chalk.hex("#3FA7D6");
const RAIN = chalk.hex("#2B6E8F");

export function banner(version: string, name?: string): string {
  const art = [
    RAIN("     ʼ      ʼ       ʼ     ʼ"),
    GRASS("  ψ ψ") + " ".repeat(16) + GRASS("ψ ψ"),
    GROUND("───╮") + " ".repeat(20) + GROUND("╭───"),
    GROUND("   ╰──╮") + " ".repeat(14) + GROUND("╭──╯"),
    GROUND("      ╰") + GROUND("─".repeat(14)) + GROUND("╯"),
    " ".repeat(7) + WATER("≈".repeat(14)),
  ];

  const words = [
    "",
    chalk.bold.hex(COLORS.ORANGE)("s w a l e"),
    chalk.gray("─────────────────────"),
    chalk.gray(`v${version}  ·  local-first`),
    name ? chalk.gray(name) : "",
    "",
  ];

  return art
    .map((line, index) => {
      const word = words[index] ?? "";
      if (!word) return line;
      // Pad on visible width: the colour codes are invisible but padEnd counts them.
      const visible = line.replace(/\u001b\[[0-9;]*m/g, "").length;
      return `${line}${" ".repeat(Math.max(0, 32 - visible))}${word}`;
    })
    .join("\n");
}
