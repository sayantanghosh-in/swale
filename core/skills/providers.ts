// library imports
import chalk from "chalk";
// local imports
import { db } from "../db.js";
import {
  CALENDAR_RAMP_GREEN,
  CALENDAR_RAMP_ORANGE,
  CALENDAR_WEEKS,
  STALE_PROJECT_DAYS,
} from "../constants.js";
import {
  formatContributionCalendar,
  formatDayStrip,
  formatDelta,
  formatGithubCalendar,
  formatHeading,
  formatLeetcodeCalendar,
  formatMetric,
  formatTable,
} from "../formatters.js";
import type { AgentContext, DisplayBlock, SkillData } from "../models.js";
import { getContributionCalendar, getContributionStats, listRepositories } from "../octokit.js";
import { getLeetcodeInsights, getLeetcodeProfileDetails } from "../services.js";
import { advanceRevision, dueRevisions, listRevisions, syncRevisions } from "../revisions/main.js";
import { gitLog, lastCommits, listRepos } from "../repos/main.js";
import {
  calendarStats,
  daysSince,
  fillCalendarWindow,
  leetcodeCalendarToDays,
  openInBrowser,
  toDateKey,
} from "../utils.js";

/*
 * The deterministic half of each skill.
 *
 * Everything here is plain data work — no model involved — so the numbers are
 * instant, always correct, and work the same on a 3B model as on a frontier
 * one. Each provider returns blocks to draw and a plain-text `facts` string;
 * only the facts are ever shown to the model.
 */

export type Provider = (ctx: AgentContext, args: string) => Promise<SkillData>;

type Period = "week" | "month" | "all";
const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30, all: 365 };
const DAY = 86_400_000;

const parsePeriod = (args: string): Period => {
  const word = args.trim().split(/\s+/)[0]?.toLowerCase();
  return word === "month" || word === "all" ? word : "week";
};

const periodLabel = (period: Period) =>
  period === "all" ? "last 12 months" : `last ${PERIOD_DAYS[period]} days`;

const sum = (values: { count: number }[]) => values.reduce((total, day) => total + day.count, 0);

/** A calendar for long windows, a strip of squares for short ones. */
const drawDays = (days: { date: string; count: number }[], ramp: string[]) =>
  days.length <= 31 ? formatDayStrip(days, ramp) : formatContributionCalendar(days, ramp);

const block = (lines: string[]): DisplayBlock => ({ text: lines.join("\n") });

/* LeetCode solved counts are a running total, so change over a window needs a
   record of what they were then. One snapshot per day, written whenever a
   skill looks at LeetCode. */
const saveSnapshot = (userId: string, totals: Record<string, number>) => {
  db.prepare(
    `INSERT INTO leetcode_snapshots (user_id, date, data) VALUES (?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET data = excluded.data`,
  ).run(userId, toDateKey(new Date()), JSON.stringify(totals));
};

const snapshotOnOrBefore = (userId: string, date: string): Record<string, number> | null => {
  const row = db
    .prepare(
      "SELECT data FROM leetcode_snapshots WHERE user_id = ? AND date <= ? ORDER BY date DESC LIMIT 1",
    )
    .get(userId, date) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Record<string, number>) : null;
};

/**
 * "12 this period, up from 8 the period before (+50%)". Spelled out, because
 * given "12 (previous period 8)" a 7B model reported the change backwards.
 */
const compareFact = (
  current: number,
  previous: number | null | undefined,
  unit: string,
): string => {
  if (previous === null || previous === undefined) return `${current} ${unit}`;
  if (current === previous) return `${current} ${unit}, the same as the period before`;
  const word = current > previous ? "up" : "down";
  const pct =
    previous === 0
      ? ""
      : ` (${word === "up" ? "+" : "-"}${Math.abs(Math.round(((current - previous) / previous) * 100))}%)`;
  return `${current} ${unit}, ${word} from ${previous} the period before${pct}`;
};

/* ------------------------------------------------------------------ */
/* summary                                                             */
/* ------------------------------------------------------------------ */

export async function collectSummary(ctx: AgentContext, period: Period): Promise<SkillData> {
  const days = PERIOD_DAYS[period];
  const now = new Date();
  const from = new Date(now.getTime() - days * DAY);
  const before = new Date(now.getTime() - 2 * days * DAY);
  const blocks: DisplayBlock[] = [];
  const facts: string[] = [`Period: ${periodLabel(period)}.`];
  const compare = period !== "all";

  if (ctx.githubLogin) {
    const [current, previous] = await Promise.all([
      getContributionStats(ctx.githubLogin, from, now),
      compare ? getContributionStats(ctx.githubLogin, before, from) : Promise.resolve(null),
    ]);

    if (current) {
      const window = fillCalendarWindow(current.days, days);
      const stats = calendarStats(window);
      const languages = [...new Set(current.repos.map((repo) => repo.language).filter(Boolean))];

      const lines = [
        formatHeading(`GitHub — ${ctx.githubLogin} · ${periodLabel(period)}`),
        formatMetric("Commits", current.commits, formatDelta(current.commits, previous?.commits)),
        formatMetric(
          "Pull requests",
          current.pullRequests,
          formatDelta(current.pullRequests, previous?.pullRequests),
        ),
        formatMetric("Issues", current.issues, formatDelta(current.issues, previous?.issues)),
        formatMetric("Reviews", current.reviews, formatDelta(current.reviews, previous?.reviews)),
        formatMetric("Active days", `${stats.activeDays}/${days}`),
        formatMetric("Current streak", `${stats.currentStreak}d`),
        formatMetric("Longest streak", `${stats.longestStreak}d`),
      ];
      if (current.repos.length) {
        lines.push(
          "",
          formatTable(
            current.repos.map((repo) => [
              chalk.cyan(repo.name),
              repo.language ?? "—",
              `${repo.commits} commit${repo.commits === 1 ? "" : "s"}`,
            ]),
            ["Most active", "Language", ""],
          ),
        );
      }
      lines.push("", drawDays(window, CALENDAR_RAMP_GREEN));
      blocks.push(block(lines));

      facts.push(
        `GitHub: ${compareFact(current.commits, previous?.commits, "commits")}; ` +
          `${current.pullRequests} pull requests, ${current.issues} issues, ${current.reviews} reviews, ` +
          `${stats.activeDays} active days of ${days}, current streak ${stats.currentStreak}d, longest ${stats.longestStreak}d.`,
        current.repos.length
          ? `Most active repos: ${current.repos.map((repo) => `${repo.name} (${repo.commits})`).join(", ")}.`
          : "No commits to any repository in this period.",
        languages.length ? `Languages: ${languages.join(", ")}.` : "",
      );
    } else {
      facts.push("GitHub could not be reached.");
    }
  }

  if (ctx.leetcodeUsername) {
    try {
      const [profile, insights] = await Promise.all([
        getLeetcodeProfileDetails(ctx.leetcodeUsername),
        getLeetcodeInsights(ctx.leetcodeUsername),
      ]);
      const byDifficulty = Object.fromEntries(
        profile.totalSubmissions.map((row) => [row.difficulty, row.count]),
      );
      const totals = {
        total: byDifficulty["All"] ?? profile.totalSolved,
        easy: byDifficulty["Easy"] ?? 0,
        medium: byDifficulty["Medium"] ?? 0,
        hard: byDifficulty["Hard"] ?? 0,
      };
      saveSnapshot(ctx.userId, totals);
      const then = compare ? snapshotOnOrBefore(ctx.userId, toDateKey(from)) : null;
      const gained = then ? totals.total - (then["total"] ?? totals.total) : null;

      const calendar = leetcodeCalendarToDays(profile.submissionCalendar);
      const twoWindows = fillCalendarWindow(calendar, days * 2);
      const window = twoWindows.slice(days);
      const submissions = sum(window);
      const previousSubmissions = compare ? sum(twoWindows.slice(0, days)) : null;
      const stats = calendarStats(window);

      const learnt = insights.topics.filter((topic) => topic.level !== "advanced");
      const strongest = [...insights.topics].sort((a, b) => b.solved - a.solved).slice(0, 3);
      const weakest = [...learnt].sort((a, b) => a.solved - b.solved).slice(0, 3);

      const lines = [
        formatHeading(`LeetCode — ${ctx.leetcodeUsername} · ${periodLabel(period)}`),
        formatMetric(
          "Solved",
          totals.total,
          gained !== null ? chalk.green(`+${gained} this period`) : "",
        ),
        formatMetric("Easy / Med / Hard", `${totals.easy}/${totals.medium}/${totals.hard}`),
        formatMetric("Submissions", submissions, formatDelta(submissions, previousSubmissions)),
        formatMetric(
          "Acceptance",
          insights.acceptanceRate !== null ? `${insights.acceptanceRate}%` : "—",
        ),
        formatMetric("Active days", `${stats.activeDays}/${days}`),
        formatMetric("Current streak", `${stats.currentStreak}d`),
        formatMetric("Longest streak", `${stats.longestStreak}d`),
      ];
      if (insights.contest) {
        lines.push(
          formatMetric(
            "Contest rating",
            insights.contest.rating,
            chalk.gray(`top ${insights.contest.topPercentage}%`),
          ),
        );
      }
      lines.push(
        "",
        `  ${chalk.gray("Strongest")}  ${strongest.map((topic) => `${topic.tag} ${chalk.bold(topic.solved)}`).join(chalk.gray(" · "))}`,
        `  ${chalk.gray("Weakest  ")}  ${weakest.map((topic) => `${topic.tag} ${chalk.bold(topic.solved)}`).join(chalk.gray(" · "))}`,
        "",
        drawDays(window, CALENDAR_RAMP_ORANGE),
      );
      blocks.push(block(lines));

      facts.push(
        `LeetCode: ${totals.total} solved in total (easy ${totals.easy}, medium ${totals.medium}, hard ${totals.hard})` +
          `${gained !== null ? `, ${gained} new this period` : ""}. Submissions: ${compareFact(submissions, previousSubmissions, "this period")}` +
          `. ` +
          `Acceptance ${insights.acceptanceRate ?? "unknown"}%. ${stats.activeDays} active days, current streak ${stats.currentStreak}d.`,
        insights.contest
          ? `Contest rating ${insights.contest.rating}, top ${insights.contest.topPercentage}% over ${insights.contest.attended} contests.`
          : "",
        `Strongest topics: ${strongest.map((topic) => `${topic.tag} (${topic.solved})`).join(", ")}.`,
        `Weakest topics: ${weakest.map((topic) => `${topic.tag} (${topic.solved})`).join(", ")}.`,
      );
    } catch {
      facts.push("LeetCode could not be reached.");
    }
  }

  if (!ctx.githubLogin && !ctx.leetcodeUsername)
    facts.push("No GitHub or LeetCode account is linked.");
  return { blocks, facts: facts.filter(Boolean).join("\n") };
}

/*
 * The model sometimes leaves the period out. Asked for "this month", it would
 * run the weekly summary and then report the week's numbers as the month's —
 * worse than failing. So an omitted period is read from what was actually asked.
 */
const periodFromWords = (text: string): string =>
  /\b(year|all[- ]time|ever|12 months)\b/i.test(text)
    ? "all"
    : /\bmonth\b/i.test(text)
      ? "month"
      : "week";

const summary: Provider = (ctx, args) =>
  collectSummary(ctx, parsePeriod(args.trim() ? args : periodFromWords(ctx.utterance ?? "")));

/* ------------------------------------------------------------------ */
/* calendar                                                            */
/* ------------------------------------------------------------------ */

const calendar: Provider = async (ctx, args) => {
  const which = args.trim().toLowerCase();
  const blocks: DisplayBlock[] = [];
  const facts: string[] = [];
  const window = CALENDAR_WEEKS * 7;

  if (which !== "leetcode" && ctx.githubLogin) {
    const contributions = await getContributionCalendar(ctx.githubLogin, window);
    if (contributions) {
      const days = fillCalendarWindow(contributions.days, window);
      blocks.push({ text: formatGithubCalendar(days, ctx.githubLogin).trim() });
      const stats = calendarStats(days);
      facts.push(
        `GitHub, last six months: ${stats.total} commits, ${stats.activeDays} active days, streak ${stats.currentStreak}d.`,
      );
    }
  }

  if (which !== "github" && ctx.leetcodeUsername) {
    try {
      const profile = await getLeetcodeProfileDetails(ctx.leetcodeUsername);
      const days = fillCalendarWindow(leetcodeCalendarToDays(profile.submissionCalendar), window);
      blocks.push({ text: formatLeetcodeCalendar(days, profile.activeYears).trim() });
      const stats = calendarStats(days);
      facts.push(
        `LeetCode, last six months: ${stats.total} submissions, ${stats.activeDays} active days, streak ${stats.currentStreak}d.`,
      );
    } catch {
      facts.push("LeetCode could not be reached.");
    }
  }

  if (!blocks.length) facts.push("No calendar available — link GitHub or LeetCode first.");
  return { blocks, facts: facts.join("\n") };
};

/* ------------------------------------------------------------------ */
/* revise                                                              */
/* ------------------------------------------------------------------ */

const problemUrl = (slug: string) => `https://leetcode.com/problems/${slug}/`;

const revise: Provider = async (ctx, args) => {
  if (!ctx.leetcodeUsername) {
    return { blocks: [], facts: "No LeetCode account is linked, so there is nothing to revise." };
  }

  try {
    const insights = await getLeetcodeInsights(ctx.leetcodeUsername);
    syncRevisions(ctx.userId, insights.recent);
  } catch {
    // Revisions already stored are still worth showing offline.
  }

  const [verb = "", target = ""] = args.trim().split(/\s+/);
  const notes: string[] = [];

  if (verb === "done") {
    const due = dueRevisions(ctx.userId);
    const index = Number.parseInt(target, 10);
    const pick = Number.isInteger(index)
      ? due[index - 1]
      : listRevisions(ctx.userId).find((r) => r.slug === target);
    if (pick) {
      const result = advanceRevision(ctx.userId, pick.slug);
      notes.push(
        result.finished
          ? `✓ ${pick.title} — finished all revisits.`
          : `✓ ${pick.title} — next revisit scheduled.`,
      );
    } else {
      notes.push(`No due revision matches "${target}".`);
    }
  }

  const due = dueRevisions(ctx.userId);
  const dueSlugs = new Set(due.map((revision) => revision.slug));
  const upcoming = listRevisions(ctx.userId).filter((revision) => !dueSlugs.has(revision.slug));

  if (verb === "next" && due[0]) {
    const opened = ctx.openLinks ? openInBrowser(problemUrl(due[0].slug)) : false;
    notes.push(
      opened ? `Opened ${due[0].title} in your browser.` : `Open ${problemUrl(due[0].slug)}`,
    );
  }

  const lines = [
    formatHeading(`LeetCode revisions — ${due.length} due today`),
    ...notes.map((note) => `  ${note}`),
  ];
  if (due.length) {
    lines.push(
      "",
      formatTable(
        due.map((revision, index) => [
          String(index + 1),
          chalk.white(revision.title),
          chalk.gray(`revisit ${revision.stage + 1} of 3`),
          chalk.cyan(problemUrl(revision.slug)),
        ]),
      ),
      "",
      chalk.gray("  /revise next opens the first one · /revise done <n> after you solve it"),
    );
  } else {
    lines.push(
      chalk.gray("  Nothing due. Problems you get wrong come back after 1, 3 and 7 days."),
    );
  }
  if (upcoming.length) {
    lines.push(
      "",
      chalk.gray(
        `  Coming up: ${upcoming
          .slice(0, 3)
          .map((r) => `${r.title} (${r.due})`)
          .join(", ")}`,
      ),
    );
  }

  return {
    blocks: [block(lines)],
    facts: [
      `${due.length} LeetCode problems are due for revision today${due.length ? `: ${due.map((r) => r.title).join(", ")}` : ""}.`,
      `${upcoming.length} more are scheduled later.`,
      ...notes,
    ].join("\n"),
  };
};

/* ------------------------------------------------------------------ */
/* pulse                                                               */
/* ------------------------------------------------------------------ */

const pulse: Provider = async (ctx) => {
  const registered = listRepos(ctx.userId);
  const [local, remote] = await Promise.all([
    lastCommits(registered),
    ctx.githubLogin ? listRepositories(ctx.githubLogin, 30) : Promise.resolve(null),
  ]);

  const projects = new Map<string, { name: string; date: string | null; subject: string }>();
  for (const repo of local)
    projects.set(repo.repo, { name: repo.repo, date: repo.date, subject: repo.subject });
  for (const repo of (remote?.res?.data ?? []) as any[]) {
    if (repo?.fork) continue;
    const pushed = repo?.pushed_at ?? repo?.updated_at ?? null;
    const existing = projects.get(repo.name);
    if (!existing || (pushed && (!existing.date || pushed > existing.date))) {
      projects.set(repo.name, { name: repo.name, date: pushed, subject: existing?.subject ?? "" });
    }
  }

  const list = [...projects.values()]
    .filter((project) => project.date)
    .map((project) => ({ ...project, age: daysSince(project.date as string) }))
    .filter((project) => project.age < 365)
    .sort((a, b) => a.age - b.age);
  /*
   * Only projects touched in the last year count. A repo untouched for a
   * decade is finished or abandoned, not "going stale" — listing those first
   * buried the one project that had just gone quiet.
   */
  const stale = list.filter((project) => project.age >= STALE_PROJECT_DAYS);

  const lines = [formatHeading(`Project pulse — ${stale.length} going stale`)];
  if (list.length) {
    lines.push(
      formatTable(
        list
          .slice(0, 10)
          .map((project) => [
            project.age >= STALE_PROJECT_DAYS ? chalk.yellow("●") : chalk.green("●"),
            chalk.white(project.name),
            chalk.gray(project.age === 0 ? "today" : `${project.age}d ago`),
            chalk.gray(project.subject.slice(0, 48)),
          ]),
      ),
    );
  } else {
    lines.push(chalk.gray("  No projects found."));
  }
  if (!registered.length) lines.push("", chalk.gray("  Add local projects with /repos add ~/code"));

  return {
    blocks: [block(lines)],
    facts: [
      `${list.length} projects, ${stale.length} with no activity for ${STALE_PROJECT_DAYS}+ days (only projects active in the last year count).`,
      ...list
        .slice(0, 10)
        .map(
          (project) =>
            `${project.name}: last activity ${project.age} days ago${project.subject ? ` ("${project.subject}")` : ""}.`,
        ),
    ].join("\n"),
  };
};

/* ------------------------------------------------------------------ */
/* plan                                                                */
/* ------------------------------------------------------------------ */

const plan: Provider = async (ctx) => {
  if (!ctx.leetcodeUsername) {
    return {
      blocks: [],
      facts: "No LeetCode account is linked, so there is no practice data to plan from.",
    };
  }
  const [profile, insights] = await Promise.all([
    getLeetcodeProfileDetails(ctx.leetcodeUsername),
    getLeetcodeInsights(ctx.leetcodeUsername),
  ]);
  syncRevisions(ctx.userId, insights.recent);
  const learnt = insights.topics.filter((topic) => topic.level !== "advanced");
  const weakest = [...learnt].sort((a, b) => a.solved - b.solved).slice(0, 5);
  const strongest = [...insights.topics].sort((a, b) => b.solved - a.solved).slice(0, 3);
  const mix = Object.fromEntries(
    profile.totalSubmissions.map((row) => [row.difficulty, row.count]),
  );
  const due = dueRevisions(ctx.userId).length;

  const lines = [
    formatHeading("Placement plan — where you stand"),
    formatTable(
      weakest.map((topic) => [
        chalk.yellow(topic.tag),
        `${topic.solved} solved`,
        chalk.gray(topic.level),
      ]),
      ["Weakest", "", ""],
    ),
    "",
    formatTable(
      strongest.map((topic) => [chalk.green(topic.tag), `${topic.solved} solved`]),
      ["Strongest", ""],
    ),
    "",
    formatMetric(
      "Easy / Med / Hard",
      `${mix["Easy"] ?? 0}/${mix["Medium"] ?? 0}/${mix["Hard"] ?? 0}`,
    ),
    formatMetric("Revisions due", due),
  ];
  if (insights.contest) lines.push(formatMetric("Contest rating", insights.contest.rating));

  return {
    blocks: [block(lines)],
    facts: [
      ctx.profile?.goal ? `Goal: ${ctx.profile.goal}.` : "",
      ctx.profile?.role ? `Role: ${ctx.profile.role}.` : "",
      `Weakest topics: ${weakest.map((topic) => `${topic.tag} (${topic.solved})`).join(", ")}.`,
      `Strongest topics: ${strongest.map((topic) => `${topic.tag} (${topic.solved})`).join(", ")}.`,
      `Solved: easy ${mix["Easy"] ?? 0}, medium ${mix["Medium"] ?? 0}, hard ${mix["Hard"] ?? 0}.`,
      `${due} revisions due.`,
      insights.contest ? `Contest rating ${insights.contest.rating}.` : "No contests attended.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
};

/* ------------------------------------------------------------------ */
/* resume                                                              */
/* ------------------------------------------------------------------ */

const resume: Provider = async (ctx) => {
  const now = new Date();
  const [remote, year, local, leetcode] = await Promise.all([
    ctx.githubLogin ? listRepositories(ctx.githubLogin, 30) : Promise.resolve(null),
    ctx.githubLogin
      ? getContributionStats(ctx.githubLogin, new Date(now.getTime() - 365 * DAY), now)
      : Promise.resolve(null),
    gitLog(listRepos(ctx.userId), 365, 500),
    ctx.leetcodeUsername
      ? Promise.all([
          getLeetcodeProfileDetails(ctx.leetcodeUsername),
          getLeetcodeInsights(ctx.leetcodeUsername),
        ]).catch(() => null)
      : Promise.resolve(null),
  ]);

  const projects = ((remote?.res?.data ?? []) as any[])
    .filter((repo) => !repo?.fork)
    .sort(
      (a, b) =>
        (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0) ||
        String(b.pushed_at).localeCompare(String(a.pushed_at)),
    )
    .slice(0, 6);
  const localCounts = new Map<string, number>();
  for (const commit of local) localCounts.set(commit.repo, (localCounts.get(commit.repo) ?? 0) + 1);

  const lines = [formatHeading("Resume — the evidence")];
  if (projects.length) {
    lines.push(
      formatTable(
        projects.map((repo) => [
          chalk.cyan(repo.name),
          repo.language ?? "—",
          `★ ${repo.stargazers_count ?? 0}`,
          chalk.gray(String(repo.description ?? "").slice(0, 50)),
        ]),
        ["Project", "Language", "", "Description"],
      ),
    );
  }
  if (year)
    lines.push(
      "",
      formatMetric("Commits, 12 months", year.commits),
      formatMetric("Pull requests", year.pullRequests),
    );
  if (leetcode) {
    const [profile, insights] = leetcode;
    lines.push(formatMetric("LeetCode solved", profile.totalSolved));
    if (insights.contest)
      lines.push(
        formatMetric(
          "Contest rating",
          insights.contest.rating,
          chalk.gray(`top ${insights.contest.topPercentage}%`),
        ),
      );
  }

  return {
    blocks: [block(lines)],
    facts: [
      ctx.profile?.role ? `Role: ${ctx.profile.role}.` : "",
      ctx.profile?.stack ? `Stack: ${ctx.profile.stack}.` : "",
      ...projects.map(
        (repo) =>
          `Project ${repo.name}: ${repo.description ?? "no description"}; ${repo.language ?? "unknown language"}; ${repo.stargazers_count ?? 0} stars` +
          `${localCounts.get(repo.name) ? `; ${localCounts.get(repo.name)} local commits this year` : ""}.`,
      ),
      year
        ? `GitHub, last 12 months: ${year.commits} commits, ${year.pullRequests} pull requests.`
        : "",
      leetcode
        ? `LeetCode: ${leetcode[0].totalSolved} problems solved${leetcode[1].contest ? `, contest rating ${leetcode[1].contest.rating} (top ${leetcode[1].contest.topPercentage}%)` : ""}.`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
};

/* ------------------------------------------------------------------ */
/* brag                                                                */
/* ------------------------------------------------------------------ */

const brag: Provider = async (ctx, args) => {
  if (args.trim().toLowerCase() === "all") {
    const entries = db
      .prepare(
        "SELECT period, commentary, data FROM skill_runs WHERE user_id = ? AND skill = 'brag' ORDER BY period DESC",
      )
      .all(ctx.userId) as { period: string; commentary: string | null; data: string | null }[];
    const lines = [formatHeading(`Brag log — ${entries.length} entries`)];
    for (const entry of entries) {
      const facts = entry.data ? ((JSON.parse(entry.data) as { facts?: string }).facts ?? "") : "";
      lines.push(
        "",
        chalk.bold(`  ${entry.period}`),
        ...(entry.commentary ?? facts).split("\n").map((line) => `  ${line}`),
      );
    }
    if (!entries.length)
      lines.push(
        chalk.gray("  Nothing yet. An entry is saved every week, or run /brag to make one now."),
      );
    return { blocks: [block(lines)], facts: "" };
  }

  const [numbers, commits] = await Promise.all([
    collectSummary(ctx, "week"),
    gitLog(listRepos(ctx.userId), 7, 30),
  ]);
  const subjects = commits.slice(0, 12);
  const lines = [formatHeading("Brag log — this week")];
  // Headline numbers only; the sentences are for the model, not the screen.
  const grab = (pattern: RegExp) => pattern.exec(numbers.facts)?.[1];
  const headline = [
    grab(/GitHub: (\d+) commits/) ? `${grab(/GitHub: (\d+) commits/)} commits` : "",
    grab(/(\d+) pull requests/) ? `${grab(/(\d+) pull requests/)} pull requests` : "",
    grab(/Submissions: (\d+) this period/)
      ? `${grab(/Submissions: (\d+) this period/)} LeetCode submissions`
      : "",
    grab(/, (\d+) new this period/) ? `${grab(/, (\d+) new this period/)} new problems solved` : "",
  ].filter(Boolean);
  if (headline.length) lines.push(`  ${headline.join(chalk.gray("  ·  "))}`);
  if (subjects.length) {
    lines.push(
      "",
      ...subjects.map((commit) => `  ${chalk.gray(commit.repo.padEnd(16))} ${commit.subject}`),
    );
  } else {
    lines.push(
      "",
      chalk.gray("  Add local projects with /repos add ~/code to include what you committed."),
    );
  }

  return {
    blocks: [block(lines)],
    /*
     * With no commit messages there is nothing true to say about what was
     * built, and asked anyway a 7B model invented features, fixes and tests
     * every time. The numbers are the entry; the model stays out of it.
     */
    skipCommentary: subjects.length === 0,
    facts: [
      numbers.facts,
      subjects.length ? "Commits this week:" : "",
      ...subjects.map((commit) => `- [${commit.repo}] ${commit.subject}`),
    ]
      .filter(Boolean)
      .join("\n"),
  };
};

export const PROVIDERS: Record<string, Provider> = {
  summary,
  calendar,
  revise,
  pulse,
  plan,
  resume,
  brag,
};
