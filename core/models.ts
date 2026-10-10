import type { OctokitResponse } from "@octokit/types";
import { z } from "zod";

export type PackageJsonContents = {
  name: string;
  version: string;
  description: string;
};

export type SupportedCurrencies = "INR" | "USD" | "EUR" | "GBP" | "Other";

export type SupportedExpenseUpdateOptions = "Amount" | "Description" | "Both";

export const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email().optional(),
  phone: z.string().optional(),
  currency: z.literal(["INR", "USD", "EUR", "GBP", "Other"]).optional(),
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserRecord = z.infer<typeof UserSchema>;

export const ConnectionsSchema = z.object({
  id: z.uuid(),
  provider: z.literal(["github", "leetcode"]),
  login: z.string(),
  name: z.string(),
  avatarUrl: z.string(),
  profileUrl: z.string(),
  connectedAt: z.date(),
  lastSyncedAt: z.date(),
  meta: z.object().optional(),
  linkedTo: z.string(),
});

export type ConnectionsRecord = z.infer<typeof ConnectionsSchema>;

export const TodoSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  status: z.literal(["todo", "in_progress", "done"]),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string(),
});

export const TodoActionSchema = z.literal(["add", "delete", "read", "list", "update"]);

export type TodoRecord = z.infer<typeof TodoSchema>;
export type TodoAction = z.infer<typeof TodoActionSchema>;

export const NoteSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string(),
});

export const NoteActionSchema = z.literal(["add", "delete", "read", "list", "update"]);

export type NoteRecord = z.infer<typeof NoteSchema>;
export type NoteAction = z.infer<typeof NoteActionSchema>;

export const ExpenseSchema = z.object({
  id: z.uuid(),
  description: z.string(),
  amount: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string(),
});

export const ExpenseActionSchema = z.literal(["add", "delete", "filter", "read", "list", "update"]);

export type ExpenseRecord = z.infer<typeof ExpenseSchema>;
export type ExpenseAction = z.infer<typeof ExpenseActionSchema>;

export type GithubUserProfileDetails = {
  name: string;
  email: string;
  res: OctokitResponse<any, number>;
};

export type GithubRepositoryDetails = {
  res: OctokitResponse<any, number>;
};

export type LeetcodeBasicDetailsMeta = {
  ranking: number;
  skills: string[];
  name: string;
  avatar: string;
};

export type LeetcodeProfileDetails = {
  submissionCalendar: {
    [key: string]: number;
  };
  activeYears: number[];
  ranking: number;
  totalSolved: number;
  totalQuestions: number;
  totalSubmissions: {
    difficulty: "All" | "Easy" | "Medium" | "Hard";
    count: number;
    submissions: number;
  }[];
  recentSubmissions: {
    title: string;
    slug: string;
    timestamp: string; // stringified timestamp "17000121212"
    statusDisplay: string;
    lang: string;
  }[];
};

/** One cell of a contribution calendar, normalised across GitHub and LeetCode. */
export type CalendarDay = {
  date: string; // YYYY-MM-DD
  count: number;
};

export type CalendarStats = {
  total: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  best: CalendarDay | null;
};

export type GithubContributions = {
  total: number;
  days: CalendarDay[];
};

export type BackupManifest = {
  formatVersion: number;
  swaleVersion: string;
  createdAt: string;
  user: { name: string; email?: string } | null;
  counts: Record<string, number>;
};

export type DashboardSnapshot = {
  user: UserRecord | null;
  githubLogin: string | null;
  leetcodeUsername: string | null;
  github: { days: CalendarDay[]; stats: CalendarStats; total: number } | null;
  leetcode: { days: CalendarDay[]; stats: CalendarStats; profile: LeetcodeProfileDetails } | null;
  todos: { open: number; recent: { id: string; text: string; status: string }[] };
  notes: { total: number };
  expenses: { monthTotal: number; monthCount: number; currency: string };
  errors: string[];
  /** Set when the snapshot came from the cache: when it was taken. */
  asOf?: string;
};

/** A file someone dropped into the composer. Nothing reads it yet. */
export type Attachment = {
  id: string;
  path: string;
  name: string;
  ext: string;
  kind: string;
  icon: string;
  bytes: number;
  /** False until a reader exists for this kind. The UI says so rather than pretending. */
  readable: boolean;
};

export type Profile = {
  role: "student" | "employed" | "freelancer" | "hobbyist" | null;
  stack: string | null;
  goal: string | null;
};

/**
 * Something a tool wants drawn rather than described. The text is already
 * rendered (colours and all) and goes straight to the screen — the model only
 * ever sees the numbers, never the drawing.
 */
export type DisplayBlock = {
  title?: string;
  text: string;
};

/** What a skill's data step produces: pictures for you, plain facts for the model. */
export type SkillData = {
  blocks: DisplayBlock[];
  facts: string;
  /** Set when there is nothing safe for the model to say — it would only invent. */
  skipCommentary?: boolean;
};

export type Skill = {
  name: string;
  description: string;
  args?: string;
  /** Built-in data step to run first, if any. */
  data?: string;
  /** "data" skills show numbers and comment on them; "chat" skills start a conversation. */
  mode: "data" | "chat";
  schedule?: string;
  group: string;
  tools?: string[];
  /** The markdown body: instructions for the model. */
  body: string;
  source: "built-in" | "installed";
  path: string;
};

export type AgentContext = {
  userId: string;
  userName: string;
  currency: string;
  githubLogin: string | null;
  leetcodeUsername: string | null;
  profile?: Profile;
  memories?: string[];
  /** The person's latest message, so a skill can fall back to it when the model omits an argument. */
  utterance?: string;
  /** Slash commands and the CLI may open a browser; the agent never does it as a side effect. */
  openLinks?: boolean;
  /** Where tools send display blocks. The TUI draws them; the CLI prints them. */
  emit?: (block: DisplayBlock) => void;
};

export type AgentToolEvent = {
  name: string;
  input: unknown;
};

export type LLMConfig = {
  type: string;
  baseUrl: string;
  model: string;
  provider?: string;
  apiKey?: string;
  numCtx?: number;
};
