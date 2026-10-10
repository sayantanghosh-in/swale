// node imports
import { randomUUID } from "node:crypto";
// local imports
import { db } from "../db.js";
import { REVISION_INTERVALS } from "../constants.js";
import { toDateKey } from "../utils.js";

export type Revision = {
  slug: string;
  title: string;
  stage: number;
  due: string;
  done: boolean;
};

const addDays = (from: Date, days: number): string => {
  const next = new Date(from);
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return toDateKey(next);
};

/**
 * Turns recent LeetCode submissions into a revision schedule.
 *
 * Any problem you got wrong is worth seeing again, even if you got it right
 * ten minutes later — the struggle is the signal. It comes back after 1, 3
 * and 7 days. A revisit counts once you submit an accepted answer on or after
 * its due date; an accepted answer from before then does not, because that is
 * just the same sitting.
 */
export const syncRevisions = (
  userId: string,
  recent: { title: string; slug: string; timestamp: number; accepted: boolean }[],
): { added: number; advanced: number } => {
  let added = 0;
  let advanced = 0;
  const now = new Date().toISOString();

  const insert = db.prepare(
    `INSERT OR IGNORE INTO revisions (id, user_id, slug, title, stage, due, done, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?)`,
  );
  for (const sub of recent) {
    if (sub.accepted) continue;
    const due = addDays(new Date(sub.timestamp), REVISION_INTERVALS[0] ?? 1);
    added += Number(insert.run(randomUUID(), userId, sub.slug, sub.title, due, now, now).changes);
  }

  const open = db
    .prepare("SELECT slug, stage, due FROM revisions WHERE user_id = ? AND done = 0")
    .all(userId) as { slug: string; stage: number; due: string }[];

  for (const revision of open) {
    const revisited = recent.some(
      (sub) =>
        sub.slug === revision.slug &&
        sub.accepted &&
        toDateKey(new Date(sub.timestamp)) >= revision.due,
    );
    if (!revisited) continue;
    advanceRevision(userId, revision.slug);
    advanced += 1;
  }

  return { added, advanced };
};

export const advanceRevision = (
  userId: string,
  slug: string,
): { success: boolean; finished?: boolean } => {
  const row = db
    .prepare("SELECT stage FROM revisions WHERE user_id = ? AND slug = ? AND done = 0")
    .get(userId, slug) as { stage: number } | undefined;
  if (!row) return { success: false };

  const stage = row.stage + 1;
  const finished = stage >= REVISION_INTERVALS.length;
  db.prepare(
    "UPDATE revisions SET stage = ?, due = ?, done = ?, updated_at = ? WHERE user_id = ? AND slug = ?",
  ).run(
    stage,
    finished ? toDateKey(new Date()) : addDays(new Date(), REVISION_INTERVALS[stage] ?? 7),
    finished ? 1 : 0,
    new Date().toISOString(),
    userId,
    slug,
  );
  return { success: true, finished };
};

export const listRevisions = (userId: string): Revision[] => {
  return (
    db
      .prepare(
        "SELECT slug, title, stage, due, done FROM revisions WHERE user_id = ? AND done = 0 ORDER BY due, title",
      )
      .all(userId) as { slug: string; title: string; stage: number; due: string; done: number }[]
  ).map((row) => ({ ...row, done: Boolean(row.done) }));
};

export const dueRevisions = (userId: string): Revision[] => {
  const today = toDateKey(new Date());
  return listRevisions(userId).filter((revision) => revision.due <= today);
};
