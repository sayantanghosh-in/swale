// library imports
import { tool, type ToolSet } from "ai";
import { z } from "zod";
// local imports
import type { AgentContext } from "./models.js";
import {
  addTodo,
  countTodosByStatus,
  createTodoObject,
  deleteTodo,
  findTodosByText,
  listTodos,
  readTodo,
  setTodoStatus,
  updateTodo,
} from "./todos/main.js";
import { addNote, countNotes, createNoteObject, listNotes } from "./notes/main.js";
import {
  addExpense,
  createExpenseObject,
  listExpenses,
  summariseExpenses,
} from "./expenses/main.js";
import { getContributionCalendar, listRepositories } from "./octokit.js";
import { getLeetcodeProfileDetails } from "./services.js";
import { calendarStats, fillCalendarWindow, leetcodeCalendarToDays, toDateKey } from "./utils.js";
import { CALENDAR_WEEKS } from "./constants.js";

/*
 * A tool is three things: a `description` the model reads to decide whether it
 * wants this one, an `inputSchema` that says what arguments are legal, and an
 * `execute` that actually runs. The schema is not decoration — the SDK sends it
 * to the model as the function signature and validates the reply against it, so
 * a bad argument never reaches the database.
 *
 * Everything here is built inside a factory that closes over `ctx`. The user id
 * is therefore never a tool argument: the model cannot ask for someone else's
 * rows, because it has no way to name them. Identity comes from the session,
 * arguments come from the model, and the two never mix.
 *
 * Tools return plain data, not sentences. Formatting is the model's job.
 *
 * Note the `hint` on the not-found errors. A tool result goes straight back
 * into the conversation, so an error message is really a prompt: given one, the
 * model fixes itself inside the same loop. Given a bare "TODO_NOT_FOUND" it
 * apologises and gives up.
 */

/*
 * Every write tool takes `match` as well as `id`.
 *
 * Asking a model for a uuid it has not read is asking it to invent one, and a
 * 7B model obliges every time. Told to call list_todos first it would announce
 * the plan and stop. So the tool accepts the words a person would actually use
 * — "the blog post one" — and does the lookup itself. The id still works when
 * there is one.
 */
const TODO_REFERENCE = {
  id: z.string().optional().describe("Exact uuid, if you have one from list_todos"),
  match: z
    .string()
    .optional()
    .describe("Words from the todo's text, e.g. 'blog post'. Use this when you have no id."),
};

type TodoLookup = { id: string } | { error: string; hint: string; candidates?: unknown[] };

function resolveTodo(userId: string, ref: { id?: string; match?: string }): TodoLookup {
  if (ref.id) {
    const found = readTodo(userId, ref.id);
    if (found?.id) return { id: ref.id };
    if (!ref.match) {
      return {
        error: "TODO_NOT_FOUND",
        hint: "That id does not exist. Retry with `match` set to words from the todo instead.",
      };
    }
  }

  if (!ref.match) {
    return { error: "NO_TODO_REFERENCE", hint: "Pass either id or match." };
  }

  const hits = findTodosByText(userId, ref.match);
  if (hits.length === 0) {
    return { error: "TODO_NOT_FOUND", hint: `Nothing matches "${ref.match}".` };
  }
  if (hits.length > 1) {
    return {
      error: "AMBIGUOUS",
      hint: "Several todos match. Ask which one, or retry with the id of the right one.",
      candidates: hits,
    };
  }
  return { id: hits[0]!.id };
}
export function buildTools(ctx: AgentContext): ToolSet {
  return {
    /*
     * The escape hatch for the forced first tool call.
     *
     * Step 0 must call something, which is what stops the model announcing a
     * saved expense it never saved. But "how are you?" has no tool to call, so
     * every conversational line was failing that check and coming back as a
     * warning about nothing being saved. This gives the model a truthful way
     * to say "this needs no data", and keeps the choice explicit.
     */
    respond_directly: tool({
      description:
        "Answer from your own knowledge, without reading or changing anything in swale. Only for conversation and general questions. Never use this when asked to add, update, finish or delete something, and never when asked about the person's own todos, notes, spending, GitHub or LeetCode — those need a real tool.",
      inputSchema: z.object({
        reason: z.string().describe("Why no swale data is needed, in a few words"),
      }),
      execute: async ({ reason }) => ({
        acknowledged: true,
        reason,
        note: "Nothing was read and nothing was changed. Do not claim otherwise.",
      }),
    }),

    today: tool({
      description:
        "The current date and time. Call this before any question involving 'today', 'this week', 'this month' or 'recently' — you do not otherwise know what day it is.",
      inputSchema: z.object({}),
      execute: async () => {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        return {
          today: toDateKey(now),
          time: now.toLocaleTimeString(),
          weekday: now.toLocaleDateString(undefined, { weekday: "long" }),
          monthStart: toDateKey(monthStart),
          user: ctx.userName,
          currency: ctx.currency,
        };
      },
    }),

    list_todos: tool({
      description:
        "The 5 most recently touched todos, plus a count of how many sit in each status. Use for 'what am I working on' and before updating anything, since changes need an id.",
      inputSchema: z.object({}),
      execute: async () => ({
        todos: listTodos(ctx.userId),
        countsByStatus: countTodosByStatus(ctx.userId),
      }),
    }),

    add_todo: tool({
      description: "Create a todo. Use the person's own wording; do not pad it out.",
      inputSchema: z.object({
        text: z.string().min(1).describe("What needs doing"),
      }),
      execute: async ({ text }) => {
        const created = createTodoObject(text, ctx.userId, "todo");
        if (!created.success) return { success: false, error: "INVALID_TODO" };
        const saved = addTodo(created.todoObj);
        return { success: saved.success, id: created.todoObj.id, text };
      },
    }),

    set_todo_status: tool({
      description:
        "Mark a todo done, in progress, or back to not started. Identify it with `match` — a few words from its text — unless you already have its id.",
      inputSchema: z.object({
        ...TODO_REFERENCE,
        status: z.enum(["todo", "in_progress", "done"]),
      }),
      execute: async ({ id, match, status }) => {
        const found = resolveTodo(ctx.userId, { id, match });
        if ("error" in found) return found;
        return { ...setTodoStatus(ctx.userId, found.id, status), id: found.id, status };
      },
    }),

    update_todo: tool({
      description: "Rewrite the text of an existing todo. Does not change its status.",
      inputSchema: z.object({ ...TODO_REFERENCE, text: z.string().min(1) }),
      execute: async ({ id, match, text }) => {
        const found = resolveTodo(ctx.userId, { id, match });
        if ("error" in found) return found;
        return { ...updateTodo(ctx.userId, found.id, text), id: found.id };
      },
    }),

    delete_todo: tool({
      description:
        "Permanently delete a todo. Prefer set_todo_status with 'done' unless the person clearly wants it gone.",
      inputSchema: z.object(TODO_REFERENCE),
      execute: async ({ id, match }) => {
        const found = resolveTodo(ctx.userId, { id, match });
        if ("error" in found) return found;
        return { ...deleteTodo(ctx.userId, found.id), id: found.id };
      },
    }),

    read_todo: tool({
      description: "One todo in full.",
      inputSchema: z.object(TODO_REFERENCE),
      execute: async ({ id, match }) => {
        const found = resolveTodo(ctx.userId, { id, match });
        if ("error" in found) return found;
        return readTodo(ctx.userId, found.id) ?? { error: "TODO_NOT_FOUND" };
      },
    }),

    list_notes: tool({
      description: "The 5 most recent notes, and how many exist in total.",
      inputSchema: z.object({}),
      execute: async () => ({
        notes: listNotes(ctx.userId),
        total: countNotes(ctx.userId),
      }),
    }),

    add_note: tool({
      description: "Save a note. For things worth keeping that are not tasks.",
      inputSchema: z.object({ text: z.string().min(1) }),
      execute: async ({ text }) => {
        const created = createNoteObject(text, ctx.userId);
        if (!created.success) return { success: false, error: "INVALID_NOTE" };
        const saved = addNote(created.noteObj);
        return { success: saved.success, id: created.noteObj.id };
      },
    }),

    list_expenses: tool({
      description:
        "The 5 most recent expenses, optionally filtered by a word in the description. For totals use summarise_expenses instead — this is capped at 5 rows and will understate any sum.",
      inputSchema: z.object({
        description: z.string().optional().describe("Substring to match, e.g. 'coffee'"),
      }),
      execute: async ({ description }) => ({
        expenses: listExpenses(ctx.userId, description),
        currency: ctx.currency,
      }),
    }),

    add_expense: tool({
      description: "Record something spent. The amount is a number in the person's own currency.",
      inputSchema: z.object({
        description: z.string().min(1),
        amount: z.number().positive(),
      }),
      execute: async ({ description, amount }) => {
        const created = createExpenseObject(description, amount, ctx.userId);
        if (!created.success) return { success: false, error: "INVALID_EXPENSE" };
        const saved = addExpense(created.expenseObj);
        return {
          success: saved.success,
          id: created.expenseObj.id,
          amount,
          currency: ctx.currency,
        };
      },
    }),

    summarise_expenses: tool({
      description:
        "Total spend, number of transactions, and the five biggest categories over a date range. Use this for any 'how much did I spend' question. Call today first to turn 'this month' into real dates.",
      inputSchema: z.object({
        since: z.string().optional().describe("Inclusive start, YYYY-MM-DD"),
        until: z.string().optional().describe("Inclusive end, YYYY-MM-DD"),
      }),
      execute: async ({ since, until }) => ({
        ...summariseExpenses(ctx.userId, since, until ? `${until}T23:59:59.999Z` : undefined),
        currency: ctx.currency,
        since: since ?? "all time",
        until: until ?? "today",
      }),
    }),

    github_repositories: tool({
      description: "The person's most recently updated public GitHub repositories.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(5),
      }),
      execute: async ({ limit }) => {
        if (!ctx.githubLogin) return { error: "NO_GITHUB_CONNECTION" };
        const result = await listRepositories(ctx.githubLogin, limit);
        if (!result) return { error: "GITHUB_REQUEST_FAILED" };
        return {
          repositories: (result.res?.data ?? []).map((repo: any) => ({
            name: repo?.name,
            description: repo?.description,
            language: repo?.language,
            stars: repo?.stargazers_count,
            updatedAt: repo?.updated_at,
            url: repo?.html_url,
          })),
        };
      },
    }),

    github_contributions: tool({
      description:
        "Commit activity over the last six months: the total, the current streak, the longest streak and the busiest day. Use for questions about how much someone has been shipping.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.githubLogin) return { error: "NO_GITHUB_CONNECTION" };
        const contributions = await getContributionCalendar(ctx.githubLogin, CALENDAR_WEEKS * 7);
        if (!contributions) return { error: "GITHUB_REQUEST_FAILED" };
        const days = fillCalendarWindow(contributions.days, CALENDAR_WEEKS * 7);
        return { windowDays: days.length, ...calendarStats(days) };
      },
    }),

    leetcode_profile: tool({
      description:
        "LeetCode standing: rank, problems solved by difficulty, submission streak, and the most recent submissions.",
      inputSchema: z.object({
        username: z
          .string()
          .optional()
          .describe(
            "Defaults to the person's own linked account; pass one only to look someone up",
          ),
      }),
      execute: async ({ username }) => {
        const handle = username ?? ctx.leetcodeUsername;
        if (!handle) return { error: "NO_LEETCODE_CONNECTION" };
        try {
          const profile = await getLeetcodeProfileDetails(handle);
          const days = fillCalendarWindow(
            leetcodeCalendarToDays(profile.submissionCalendar),
            CALENDAR_WEEKS * 7,
          );
          return {
            username: handle,
            ranking: profile.ranking,
            totalSolved: profile.totalSolved,
            totalQuestions: profile.totalQuestions,
            byDifficulty: profile.totalSubmissions,
            activeYears: profile.activeYears,
            streak: calendarStats(days),
            recent: profile.recentSubmissions.slice(0, 5),
          };
        } catch {
          return { error: "LEETCODE_REQUEST_FAILED" };
        }
      },
    }),
  };
}
