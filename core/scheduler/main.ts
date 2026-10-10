// node imports
import { randomUUID } from "node:crypto";
// local imports
import { db } from "../db.js";
import type { AgentContext, DisplayBlock, Skill, SkillData } from "../models.js";
import { loadSkills } from "../skills/main.js";
import { runSkillData, writeCommentary } from "../skills/runner.js";
import { toDateKey } from "../utils.js";

/*
 * A scheduler with no background process.
 *
 * Skills say when they should run (`schedule: daily`, `weekly monday`,
 * `monthly`). Nothing runs while swale is closed. When it opens — or while it
 * stays open — anything whose period has passed runs once. Each run is stamped
 * with its period (2026-10-10, 2026-W41, 2026-10), and the database refuses a
 * second row for the same period, so being away for a week means one catch-up
 * run, never seven.
 */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** ISO week, e.g. 2026-W41. Weeks start on Monday. */
const isoWeek = (date: Date): string => {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

export const periodKey = (schedule: string, date = new Date()): string | null => {
  const [kind] = schedule.trim().toLowerCase().split(/\s+/);
  if (kind === "daily") return toDateKey(date);
  if (kind === "weekly") return isoWeek(date);
  if (kind === "monthly") return toDateKey(date).slice(0, 7);
  return null;
};

/** A weekly skill waits until its weekday arrives; Sunday counts as the end of the week. */
const weekdayReached = (schedule: string, date: Date): boolean => {
  const [kind, day] = schedule.trim().toLowerCase().split(/\s+/);
  if (kind !== "weekly" || !day) return true;
  const target = WEEKDAYS.indexOf(day);
  if (target < 0) return true;
  const toMondayFirst = (n: number) => (n + 6) % 7;
  return toMondayFirst(date.getDay()) >= toMondayFirst(target);
};

const lastRun = (
  userId: string,
  skill: string,
): { period: string; created_at: string } | undefined =>
  db
    .prepare(
      "SELECT period, created_at FROM skill_runs WHERE user_id = ? AND skill = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(userId, skill) as { period: string; created_at: string } | undefined;

export const dueSkills = (userId: string, now = new Date()): Skill[] =>
  loadSkills().filter((skill) => {
    if (!skill.schedule) return false;
    const period = periodKey(skill.schedule, now);
    if (!period || !weekdayReached(skill.schedule, now)) return false;
    return lastRun(userId, skill.name)?.period !== period;
  });

export const recordRun = (
  userId: string,
  skill: Skill,
  data: SkillData,
  commentary: string | null,
  now = new Date(),
) => {
  const period = (skill.schedule && periodKey(skill.schedule, now)) || toDateKey(now);
  db.prepare(
    `INSERT INTO skill_runs (id, user_id, skill, period, data, commentary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, skill, period) DO UPDATE SET data = excluded.data,
       commentary = COALESCE(excluded.commentary, skill_runs.commentary), created_at = excluded.created_at`,
  ).run(
    randomUUID(),
    userId,
    skill.name,
    period,
    JSON.stringify(data),
    commentary,
    now.toISOString(),
  );
};

/**
 * Runs everything due, one at a time. Numbers are reported the moment they
 * exist; the model's commentary follows when it is ready, which on a small
 * local model can be several seconds later.
 */
export async function runDueSkills(
  ctx: AgentContext,
  hooks: {
    onData?: (skill: Skill, data: SkillData) => void;
    onCommentary?: (skill: Skill, text: string) => void;
    withCommentary?: boolean;
  } = {},
): Promise<Skill[]> {
  const due = dueSkills(ctx.userId);
  for (const skill of due) {
    const data = await runSkillData(skill, ctx);
    recordRun(ctx.userId, skill, data, null);
    hooks.onData?.(skill, data);
    if (hooks.withCommentary === false) continue;
    const commentary = await writeCommentary(skill, ctx, data);
    if (commentary) {
      recordRun(ctx.userId, skill, data, commentary);
      hooks.onCommentary?.(skill, commentary);
    }
  }
  return due;
}

/** Runs in the current period, for /today. */
export const todaysRuns = (
  userId: string,
  now = new Date(),
): { skill: string; blocks: DisplayBlock[]; facts: string; commentary: string | null }[] =>
  loadSkills()
    .filter((skill) => skill.schedule)
    .flatMap((skill) => {
      const period = periodKey(skill.schedule as string, now);
      const row = db
        .prepare(
          "SELECT data, commentary FROM skill_runs WHERE user_id = ? AND skill = ? AND period = ?",
        )
        .get(userId, skill.name, period) as
        { data: string | null; commentary: string | null } | undefined;
      if (!row?.data) return [];
      const data = JSON.parse(row.data) as SkillData;
      return [
        { skill: skill.name, blocks: data.blocks, facts: data.facts, commentary: row.commentary },
      ];
    });

export const scheduleOverview = (userId: string, now = new Date()) =>
  loadSkills()
    .filter((skill) => skill.schedule)
    .map((skill) => {
      const last = lastRun(userId, skill.name);
      const due = dueSkills(userId, now).some((entry) => entry.name === skill.name);
      return {
        name: skill.name,
        schedule: skill.schedule as string,
        lastRun: last?.created_at ?? null,
        due,
      };
    });
