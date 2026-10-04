// library imports
import chalk from "chalk";
import stringWidth from "string-width";
// local imports
import { CALENDAR_RAMP_GREEN, CALENDAR_RAMP_ORANGE, COLORS } from "../core/constants.js";
import { formatCalendarStats, formatContributionCalendar } from "../core/formatters.js";
import type { DashboardSnapshot } from "../core/models.js";
import { banner } from "./banner.js";

/*
 * The dashboard as one coloured string.
 *
 * Not JSX, deliberately. Its height has to be known before layout so the gap
 * that pushes the prompt to the bottom of the screen can be sized, and Ink's
 * renderToString cannot be called while a live render is mounted — the two
 * share one yoga WASM instance and the second layout pass crashes it. A string
 * can simply be counted. The dashboard never changes after it loads, so there
 * is nothing JSX would buy here anyway.
 */
export type DashboardOptions = {
  /** Terminal too narrow for a 56-column calendar grid. */
  narrow: boolean;
  /** Drop the blank lines between sections. */
  compact?: boolean;
  /** Drop the mascot and fall back to a one-line title. */
  showBanner?: boolean;
};

export function dashboardText(
  snapshot: DashboardSnapshot,
  version: string,
  options: DashboardOptions,
): string {
  const { narrow, compact = false, showBanner = true } = options;
  const lines: string[] = [];
  const blank = () => {
    if (!compact) lines.push("");
  };

  if (showBanner) {
    lines.push(banner(version, snapshot.user?.name ?? undefined));
  } else {
    lines.push(
      chalk.bold.hex(COLORS.ORANGE)(`swale `) +
        chalk.gray(`v${version}`) +
        (snapshot.user?.name ? chalk.gray(`  ·  ${snapshot.user.name}`) : ""),
    );
  }

  if (snapshot.github) {
    blank();
    lines.push(chalk.bold.hex(COLORS.ORANGE)(`GitHub — ${snapshot.githubLogin}`));
    if (!narrow) lines.push(formatContributionCalendar(snapshot.github.days, CALENDAR_RAMP_GREEN));
    blank();
    lines.push(`  ${formatCalendarStats(snapshot.github.stats, "commits")}`);
  }

  if (snapshot.leetcode) {
    blank();
    lines.push(chalk.bold.hex(COLORS.ORANGE)(`LeetCode — ${snapshot.leetcodeUsername}`));
    if (!narrow) {
      lines.push(formatContributionCalendar(snapshot.leetcode.days, CALENDAR_RAMP_ORANGE));
    }
    blank();
    lines.push(`  ${formatCalendarStats(snapshot.leetcode.stats, "submissions")}`);
    lines.push(
      chalk.gray(
        `  Solved ${snapshot.leetcode.profile.totalSolved}/${snapshot.leetcode.profile.totalQuestions} · rank ${snapshot.leetcode.profile.ranking}`,
      ),
    );
  }

  blank();
  lines.push(
    `  ${chalk.gray("todo")} ${chalk.cyan.bold(snapshot.todos.open)} ${chalk.gray("open")}` +
      `   ${chalk.gray("notes")} ${chalk.cyan.bold(snapshot.notes.total)}` +
      `   ${chalk.gray("this month")} ${chalk.yellow.bold(
        `${snapshot.expenses.currency} ${snapshot.expenses.monthTotal}`,
      )} ${chalk.gray(`over ${snapshot.expenses.monthCount}`)}`,
  );

  for (const error of snapshot.errors) {
    lines.push(chalk.yellow(`  ! ${error}`));
  }

  return lines.join("\n");
}

/**
 * How many terminal rows a block of text really occupies.
 *
 * Counting newlines is not enough: a line wider than the terminal wraps onto
 * further rows, and an emoji is two cells wide while being one character
 * long. Both were enough to push the banner off the top of a narrow window.
 */
export function wrappedHeight(text: string, columns: number): number {
  if (columns <= 0) return text.split("\n").length;
  return text
    .split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil(stringWidth(line) / columns)), 0);
}

/**
 * The tallest version of the dashboard that still fits above the prompt.
 *
 * Without this the banner loses its top row on a short terminal: the content
 * comes to exactly the terminal height, the final newline lands past the last
 * row, and everything scrolls up by one. Rather than let that happen the
 * dashboard gives up its spacing first, then the mascot, then the calendars.
 */
export function fitDashboard(
  snapshot: DashboardSnapshot,
  version: string,
  narrow: boolean,
  maxHeight: number,
  columns: number,
): { text: string; height: number } {
  const tiers: DashboardOptions[] = [
    { narrow },
    { narrow, compact: true },
    { narrow, compact: true, showBanner: false },
    { narrow: true, compact: true, showBanner: false },
  ];

  let smallest = { text: "", height: Number.POSITIVE_INFINITY };

  for (const tier of tiers) {
    const text = dashboardText(snapshot, version, tier);
    const height = wrappedHeight(text, columns);
    if (height <= maxHeight) return { text, height };
    if (height < smallest.height) smallest = { text, height };
  }

  // Nothing fits — a very short terminal. Show the smallest and let it scroll.
  return smallest;
}
