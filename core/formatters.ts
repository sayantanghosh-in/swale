// library imports
import chalk from "chalk";
// local imports
import type {
  CalendarDay,
  CalendarStats,
  GithubRepositoryDetails,
  LeetcodeProfileDetails,
} from "./models.js";
import {
  CALENDAR_CELL,
  CALENDAR_EMPTY,
  CALENDAR_RAMP_GREEN,
  CALENDAR_RAMP_ORANGE,
  COLORS,
  MONTH_LABELS,
} from "./constants.js";
import { calendarStats, heatLevel } from "./utils.js";

export function formatLastRepositories(repos: GithubRepositoryDetails["res"]): string {
  let res = "";
  if (!Array.isArray(repos) || !repos.length) {
    res = "No repositories found...";
  } else {
    res += chalk.hex(COLORS.ORANGE).bold`Last modified repos:`;
    repos.forEach((r) => {
      res += `
👉 ${chalk.yellow(r?.name)} ⏰ ${chalk.underlineCurly.gray(new Date(r?.updated_at).toDateString())}
🔗 ${chalk.cyanBright(r?.html_url)}
💬 ${chalk.italic.blueBright(r?.description)}
`;
    });
  }
  return res;
}

export function formatLeetcodeContributions(
  data: LeetcodeProfileDetails,
  username: string,
): string {
  let res = "";
  res += chalk
    .hex(COLORS.ORANGE)
    .bold(`Leetcode (${chalk.cyan.bold.underlineDouble(username)}):\n`);
  res += `🚀 ${chalk.white.underlineDashed("Ranking:")} ${chalk.blue.green.bold(data?.ranking)}\n`;
  res += `⭐️ ${chalk.white.underlineDashed("Solved:")} ${chalk.blue.yellow.bold(" " + data?.totalSolved + " ")}/${chalk.blueBright(data?.totalQuestions)}\n`;
  res += `⚡️ ${chalk.hex(COLORS.ORANGE).bold("All:")} ${chalk.cyan.underline(data?.totalSubmissions[0]?.count)} ${chalk.green.bold("Easy:")} ${chalk.cyan.underline(data?.totalSubmissions[1]?.count)} ${chalk.yellow.bold("Med:")} ${chalk.cyan.underline(data?.totalSubmissions[2]?.count)}  ${chalk.red.bold("Hard:")} ${chalk.cyan.underline(data?.totalSubmissions[3]?.count)}`;
  if (!(Array.isArray(data?.recentSubmissions) && data?.recentSubmissions?.length)) {
    return res;
  }
  res += chalk.hex(COLORS.ORANGE).bold("\n\nLast Solved:");
  for (let i = 0; i < 5; i++) {
    const sub = data?.recentSubmissions[i];
    res += `\n👉 ${chalk.yellow(sub?.title)} ⏰ ${chalk.underlineCurly.gray(new Date(Number(sub?.timestamp) * 1000).toDateString())}\n`;
    res += `${sub?.statusDisplay === "Accepted" ? "✅" : sub?.statusDisplay?.toLowerCase()?.startsWith("wrong") ? "❌" : "🤔"} ${sub?.statusDisplay?.toLowerCase() === "accepted" ? chalk.green("Accepted") : sub?.statusDisplay?.toLowerCase()?.startsWith("wrong") ? chalk.red(sub?.statusDisplay) : chalk.yellow(sub?.statusDisplay)}\n`;
    res += `🔗 ${chalk.cyanBright("https://leetcode.com/problems/" + sub?.slug)}\n`;
  }
  return res;
}

/* --------------------------------------------------------------------------
 * Contribution calendar
 * ----------------------------------------------------------------------- */

const DAY_LABELS = ["   ", "Mon", "   ", "Wed", "   ", "Fri", "   "];

/**
 * Draws a GitHub-style heat grid: one column per week, one row per weekday.
 * Columns are built first and transposed, because a terminal prints by row
 * but a calendar reads by week.
 */
export function formatContributionCalendar(
  days: CalendarDay[],
  ramp: string[] = CALENDAR_RAMP_GREEN,
): string {
  if (!days.length) return chalk.gray("  No activity data available.");

  const max = days.reduce((top, day) => Math.max(top, day.count), 0);

  // Pad the front so the first column starts on a Sunday.
  const firstDate = new Date(`${days[0]?.date}T12:00:00`);
  const leading = firstDate.getDay();
  const padded: (CalendarDay | null)[] = [...Array(leading).fill(null), ...days];

  const columns: (CalendarDay | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) {
    columns.push(padded.slice(i, i + 7));
  }

  /*
   * Month labels. A cell is 2 chars wide but "Jan" is 3, so the label is laid
   * into a character buffer rather than appended per column — appending
   * truncated every name to 2 chars and turned June and July into "Ju" twice.
   */
  const slots = new Array(columns.length * 2).fill(" ");
  let lastMonth = -1;
  columns.forEach((column, index) => {
    const firstReal = column.find((day): day is CalendarDay => day !== null);
    if (!firstReal) return;
    const month = new Date(`${firstReal.date}T12:00:00`).getMonth();
    if (month === lastMonth) return;
    lastMonth = month;

    const label = MONTH_LABELS[month] ?? "";
    const start = index * 2;
    if (start + label.length > slots.length) return;
    // Don't write over a label that is still being printed.
    if (slots.slice(Math.max(0, start - 1), start).some((char) => char !== " ")) return;
    for (let i = 0; i < label.length; i++) slots[start + i] = label[i];
  });
  const monthRow = "    " + chalk.gray(slots.join(""));

  const rows: string[] = [monthRow];
  for (let weekday = 0; weekday < 7; weekday++) {
    let row = chalk.gray(`${DAY_LABELS[weekday]} `);
    for (const column of columns) {
      const day = column[weekday];
      if (!day) {
        row += "  ";
        continue;
      }
      const level = heatLevel(day.count, max);
      const colour = ramp[level] ?? ramp[0] ?? "#30363D";
      row += chalk.hex(colour)(level === 0 ? CALENDAR_EMPTY : CALENDAR_CELL) + " ";
    }
    rows.push(row);
  }

  const legend =
    chalk.gray("    Less ") +
    ramp.map((colour) => chalk.hex(colour)(CALENDAR_CELL)).join(" ") +
    chalk.gray(" More");

  return `${rows.join("\n")}\n${legend}`;
}

export function formatCalendarStats(stats: CalendarStats, unit: string): string {
  const flame = stats.currentStreak > 0 ? "🔥" : "💤";
  return [
    `${flame} ${chalk.white("Streak:")} ${chalk.bold.hex(COLORS.ORANGE)(stats.currentStreak)}d`,
    `${chalk.white("Best:")} ${chalk.bold.cyan(stats.longestStreak)}d`,
    `${chalk.white("Active:")} ${chalk.bold.green(stats.activeDays)}d`,
    `${chalk.white("Total:")} ${chalk.bold.yellow(stats.total)} ${unit}`,
  ].join(chalk.gray(" │ "));
}

export function formatGithubCalendar(days: CalendarDay[], login: string): string {
  const stats = calendarStats(days);
  let res = chalk.hex(COLORS.ORANGE).bold(`\nGitHub contributions (${chalk.cyan.bold(login)}):\n`);
  res += `${formatContributionCalendar(days, CALENDAR_RAMP_GREEN)}\n\n`;
  res += `  ${formatCalendarStats(stats, "commits")}\n`;
  return res;
}

export function formatLeetcodeCalendar(days: CalendarDay[], activeYears: number[] = []): string {
  const stats = calendarStats(days);
  let res = chalk.hex(COLORS.ORANGE).bold("\nSubmission calendar:\n");
  res += `${formatContributionCalendar(days, CALENDAR_RAMP_ORANGE)}\n\n`;
  res += `  ${formatCalendarStats(stats, "submissions")}\n`;

  // An empty grid looks like a bug. Say which it is.
  if (stats.total === 0 && activeYears.length) {
    const lastActive = Math.max(...activeYears);
    res += chalk.gray(`  Nothing in this window — last active in ${lastActive}.\n`);
  }
  return res;
}
