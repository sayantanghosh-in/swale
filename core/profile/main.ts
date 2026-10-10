// node imports
import { randomUUID } from "node:crypto";
// local imports
import { db } from "../db.js";
import { PROFILE_ROLES } from "../constants.js";
import type { Profile } from "../models.js";

export const getProfile = (userId: string): Profile => {
  const row = db.prepare("SELECT role, stack, goal FROM profile WHERE user_id = ?").get(userId) as
    { role: string | null; stack: string | null; goal: string | null } | undefined;
  return {
    role: (row?.role as Profile["role"]) ?? null,
    stack: row?.stack ?? null,
    goal: row?.goal ?? null,
  };
};

export const setProfileField = (
  userId: string,
  field: keyof Profile,
  value: string,
): { success: boolean; error?: string } => {
  const clean = value.trim();
  if (field === "role" && !(PROFILE_ROLES as readonly string[]).includes(clean)) {
    return { success: false, error: `role must be one of: ${PROFILE_ROLES.join(", ")}` };
  }
  const current = getProfile(userId);
  const next = { ...current, [field]: clean || null };
  db.prepare(
    `INSERT INTO profile (user_id, role, stack, goal, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, stack = excluded.stack,
       goal = excluded.goal, updated_at = excluded.updated_at`,
  ).run(userId, next.role, next.stack, next.goal, new Date().toISOString());
  return { success: true };
};

export const hasProfile = (userId: string): boolean => Boolean(getProfile(userId).role);

export const listMemories = (userId: string): { id: string; text: string }[] => {
  return db
    .prepare("SELECT id, text FROM memories WHERE user_id = ? ORDER BY created_at")
    .all(userId) as { id: string; text: string }[];
};

export const addMemory = (userId: string, text: string): { success: boolean } => {
  const clean = text.trim();
  if (!clean) return { success: false };
  const ran = db
    .prepare("INSERT INTO memories (id, user_id, text, created_at) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), userId, clean, new Date().toISOString());
  return { success: ran.changes === 1 };
};

/** Forget by 1-based position in /memory, or by matching text. */
export const forgetMemory = (
  userId: string,
  which: string,
): { success: boolean; text?: string } => {
  const all = listMemories(userId);
  const index = Number.parseInt(which, 10);
  const target = Number.isInteger(index)
    ? all[index - 1]
    : all.find((memory) => memory.text.toLowerCase().includes(which.toLowerCase()));
  if (!target) return { success: false };
  db.prepare("DELETE FROM memories WHERE id = ?").run(target.id);
  return { success: true, text: target.text };
};
