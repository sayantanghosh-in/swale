// node imports
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
// local imports
import {
  CALENDAR_RAMP_GREEN,
  CALENDAR_RAMP_ORANGE,
  CARDS_DIR_NAME,
  CALENDAR_WEEKS,
} from "../constants.js";
import type { AgentContext, CalendarDay } from "../models.js";
import { getContributionCalendar, getContributionStats } from "../octokit.js";
import { getLeetcodeInsights, getLeetcodeProfileDetails } from "../services.js";
import {
  calendarStats,
  ensureDataDir,
  fillCalendarWindow,
  heatLevel,
  leetcodeCalendarToDays,
  toDateKey,
} from "../utils.js";

/*
 * `swale card` — an image of your progress you would actually post.
 *
 * Drawn as SVG by hand, then rasterised with resvg using the fonts already on
 * the machine, so it needs no browser and no network beyond the data itself.
 * If the rasteriser cannot load (an unusual platform), you still get the SVG.
 */

const W = 1200;
const H = 630;
const FONT = "Menlo, 'SF Mono', 'DejaVu Sans Mono', Consolas, monospace";
const DAY = 86_400_000;

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char,
  );

const text = (
  x: number,
  y: number,
  size: number,
  fill: string,
  content: string,
  weight = 400,
  anchor = "start",
) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(content)}</text>`;

/** A contribution grid as rects: one column a week, one row a weekday. */
const grid = (days: CalendarDay[], ramp: string[], x: number, y: number, cell: number) => {
  if (!days.length) return "";
  const max = days.reduce((top, day) => Math.max(top, day.count), 0);
  const lead = new Date(`${days[0]?.date}T12:00:00`).getDay();
  return days
    .map((day, index) => {
      const slot = index + lead;
      const level = heatLevel(day.count, max);
      return `<rect x="${x + Math.floor(slot / 7) * (cell + 3)}" y="${y + (slot % 7) * (cell + 3)}" width="${cell}" height="${cell}" rx="2" fill="${ramp[level] ?? ramp[0]}"/>`;
    })
    .join("");
};

const stat = (x: number, y: number, value: string, label: string, colour: string) =>
  text(x, y, 44, colour, value, 700) + text(x, y + 26, 16, "#8b919c", label);

const MARK = `
  <g transform="translate(64 56) scale(0.22)">
    <path d="M40 118 L150 118 C205 118 210 232 265 232 L395 232 C450 232 455 118 510 118 L620 118" fill="none" stroke="#F97D09" stroke-width="16" stroke-linecap="round"/>
    <path d="M258 205 q19 -13 38 0 t38 0 t38 0" stroke="#5BC4F1" stroke-width="9" fill="none" stroke-linecap="round"/>
    <g stroke="#4FA355" stroke-width="7" stroke-linecap="round" fill="none"><path d="M80 110 v-30 M66 110 q3 -22 -9 -34 M94 110 q-3 -22 9 -34"/><path d="M570 110 v-30 M556 110 q3 -22 -9 -34 M584 110 q-3 -22 9 -34"/></g>
  </g>`;

export async function generateCard(
  ctx: AgentContext,
  period: "week" | "month",
): Promise<{ path?: string; error?: string }> {
  const days = period === "month" ? 30 : 7;
  const now = new Date();
  const from = new Date(now.getTime() - days * DAY);
  const window = CALENDAR_WEEKS * 7;

  const [stats, calendar, leetcode] = await Promise.all([
    ctx.githubLogin ? getContributionStats(ctx.githubLogin, from, now) : Promise.resolve(null),
    ctx.githubLogin ? getContributionCalendar(ctx.githubLogin, window) : Promise.resolve(null),
    ctx.leetcodeUsername
      ? Promise.all([
          getLeetcodeProfileDetails(ctx.leetcodeUsername),
          getLeetcodeInsights(ctx.leetcodeUsername),
        ]).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!stats && !leetcode)
    return { error: "Link GitHub or LeetCode first — the card is made from them." };

  const ghDays = calendar ? fillCalendarWindow(calendar.days, window) : [];
  const ghPeriod = calendarStats(ghDays.slice(-days));
  const lcAll = leetcode
    ? fillCalendarWindow(leetcodeCalendarToDays(leetcode[0].submissionCalendar), window)
    : [];
  const lcPeriod = calendarStats(lcAll.slice(-days));
  const label = period === "month" ? "last 30 days" : "last 7 days";

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" rx="28" fill="#11111b"/>`,
    MARK,
    text(220, 92, 40, "#F97D09", "swale", 700),
    text(1136, 80, 22, "#e6e6e6", ctx.userName, 700, "end"),
    text(1136, 108, 16, "#8b919c", label, 400, "end"),
    `<rect x="64" y="150" width="1072" height="2" fill="#24242e"/>`,
  ];

  // GitHub, left half
  parts.push(
    text(
      64,
      200,
      20,
      "#4FA355",
      ctx.githubLogin ? `GitHub · ${ctx.githubLogin}` : "GitHub · not linked",
      700,
    ),
  );
  if (stats) {
    parts.push(
      stat(64, 262, String(stats.commits), "commits", "#e6e6e6"),
      stat(224, 262, String(stats.pullRequests), "pull requests", "#e6e6e6"),
      stat(400, 262, `${ghPeriod.activeDays}/${days}`, "active days", "#7EE787"),
      grid(ghDays, CALENDAR_RAMP_GREEN, 64, 330, 14),
    );
  }

  // LeetCode, right half
  parts.push(
    text(
      630,
      200,
      20,
      "#F97D09",
      ctx.leetcodeUsername ? `LeetCode · ${ctx.leetcodeUsername}` : "LeetCode · not linked",
      700,
    ),
  );
  if (leetcode) {
    const [profile, insights] = leetcode;
    const mix = Object.fromEntries(
      profile.totalSubmissions.map((row) => [row.difficulty, row.count]),
    );
    parts.push(
      stat(630, 262, String(profile.totalSolved), "solved", "#e6e6e6"),
      stat(790, 262, `${lcPeriod.currentStreak}d`, "streak", "#FFAE5C"),
      stat(
        930,
        262,
        insights.contest ? String(insights.contest.rating) : `${mix["Medium"] ?? 0}`,
        insights.contest ? "contest rating" : "medium solved",
        "#e6e6e6",
      ),
      grid(lcAll, CALENDAR_RAMP_ORANGE, 630, 330, 14),
      text(
        630,
        520,
        15,
        "#8b919c",
        `easy ${mix["Easy"] ?? 0} · medium ${mix["Medium"] ?? 0} · hard ${mix["Hard"] ?? 0}`,
      ),
    );
  }

  parts.push(
    `<rect x="64" y="560" width="1072" height="2" fill="#24242e"/>`,
    text(64, 596, 16, "#8b919c", "made with swale  ·  npm i -g @itssayantan/swale"),
    text(1136, 596, 16, "#5f6672", toDateKey(now), 400, "end"),
    "</svg>",
  );

  const svg = parts.join("\n");
  const dir = path.join(ensureDataDir(), CARDS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `swale-${period}-${toDateKey(now)}`);

  try {
    const { Resvg } = await import("@resvg/resvg-js");
    const png = new Resvg(svg, {
      font: { loadSystemFonts: true },
      fitTo: { mode: "width", value: W * 2 },
    })
      .render()
      .asPng();
    writeFileSync(`${base}.png`, png);
    return { path: `${base}.png` };
  } catch {
    writeFileSync(`${base}.svg`, svg);
    return { path: `${base}.svg` };
  }
}
