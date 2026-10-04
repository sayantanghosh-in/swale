// library imports
import { stepCountIs, ToolChoiceViolationError, ToolLoopAgent, type ModelMessage } from "ai";
// local imports
import { AGENT_MAX_STEPS } from "./constants.js";
import type { AgentContext, AgentToolEvent } from "./models.js";
import { buildTools } from "./tools.js";
import { getLlmDetails, resolveModel, toDateKey } from "./utils.js";
import { getActiveUser } from "./users/main.js";
import { fetchLoginByProvider } from "./connections/main.js";

/*
 * The system prompt is the agent's job description.
 *
 * Written against the two things a small local model actually gets wrong here:
 * it invents dates, and it reports writes it never performed. The date is
 * therefore handed to it rather than left to a tool call, and the rule about
 * writing is stated as a prohibition with the failure spelled out — "call the
 * tool first" on its own was not enough to stop qwen2.5 announcing a saved
 * expense it had not saved.
 */
function instructionsFor(ctx: AgentContext): string {
  const now = new Date();
  const monthStart = toDateKey(new Date(now.getFullYear(), now.getMonth(), 1));

  return [
    `You are swale, a command line assistant on ${ctx.userName}'s own machine.`,
    "",
    `Today is ${toDateKey(now)}, a ${now.toLocaleDateString(undefined, { weekday: "long" })}.`,
    `This month began on ${monthStart}. Use these dates. Never guess a date.`,
    `Money is in ${ctx.currency}.`,
    "",
    "HOW YOU WORK",
    "Every answer begins with a tool call. If the question genuinely needs no",
    "data from swale and asks for no change, call respond_directly and then",
    "answer normally — that is the whole of its purpose.",
    "",
    "You cannot change anything by saying so. Saving a todo, an expense or a note",
    "happens only when you call the matching tool and it returns success:true.",
    "If you have not called the tool in this turn, nothing has been saved, and",
    "claiming otherwise is a lie to the person who trusts this output.",
    "",
    "So: when asked to add, record, save, update, finish or delete something,",
    "call the tool. Then report what the tool returned. If it returned an error,",
    "say so plainly rather than papering over it.",
    "",
    "To change a todo, pass `match` with a few words from it. Never type a uuid",
    "you have not read from list_todos — invented ids match nothing.",
    "",
    "Never state a number you have not read from a tool in this turn.",
    "For spending totals use summarise_expenses, not list_expenses — list_expenses",
    "returns at most 5 rows and any sum of it will be wrong.",
    "",
    "STYLE",
    "Terminal output. At most four lines. No markdown headings, no preamble,",
    "no restating the question back.",
    ctx.githubLogin ? `GitHub account: ${ctx.githubLogin}.` : "No GitHub account is linked.",
    ctx.leetcodeUsername
      ? `LeetCode account: ${ctx.leetcodeUsername}.`
      : "No LeetCode account is linked.",
  ].join("\n");
}

/** Reads who is signed in. Returns null when nobody is, so callers can prompt. */
export function resolveAgentContext(): AgentContext | null {
  const user = getActiveUser();
  if (!user?.id) return null;

  const github = fetchLoginByProvider(user.id, "github");
  const leetcode = fetchLoginByProvider(user.id, "leetcode");

  return {
    userId: user.id,
    userName: user.name,
    currency: user.currency ?? "INR",
    githubLogin: github?.success ? github.login : null,
    leetcodeUsername: leetcode?.success ? leetcode.login : null,
  };
}

/**
 * A ToolLoopAgent is the loop you would otherwise write by hand: ask the model,
 * run whatever tools it asked for, hand the results back, ask again. `stopWhen`
 * is the brake — without it a model that keeps calling tools never returns.
 */
export function createSwaleAgent(ctx: AgentContext) {
  const llm = getLlmDetails();
  if (!llm) throw new Error("ERROR_NO_LLM_FOUND");

  return new ToolLoopAgent({
    model: resolveModel(llm),
    instructions: instructionsFor(ctx),
    tools: buildTools(ctx),
    stopWhen: stepCountIs(AGENT_MAX_STEPS),
    temperature: 0,
    /*
     * The first step must call a tool; after that the model is free.
     *
     * This is the one hard guarantee against the failure that matters: a 7B
     * model asked to "mark that one done" will otherwise reply "Todo marked as
     * done" having called nothing at all, and the person believes it. Forcing
     * step 0 means every answer is grounded in something that actually ran.
     *
     * The cost is that small talk also spends a tool call. Worth it.
     */
    prepareStep: ({ stepNumber }) => (stepNumber === 0 ? { toolChoice: "required" } : {}),
  });
}

export type AgentRunOptions = {
  messages: ModelMessage[];
  onToolCall?: (event: AgentToolEvent) => void;
  onText?: (chunk: string) => void;
  abortSignal?: AbortSignal;
};

/**
 * When the model ignores the forced tool call, the SDK raises
 * ToolChoiceViolationError and the text it produced is fiction. Translate that
 * into something the person can act on rather than leaking the class name.
 */
function readableError(error: unknown): Error {
  if (ToolChoiceViolationError.isInstance(error)) {
    return new Error(
      "The model replied without using a tool, so nothing was saved or changed. Ask again more directly, or switch to a larger model with `swale llm`.",
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Runs one turn and streams it. Tool calls are surfaced through `onToolCall` so
 * the caller can show what the agent is doing — an agent that goes quiet for
 * eight seconds looks broken, even when it is working.
 */
export async function runAgent(
  ctx: AgentContext,
  { messages, onToolCall, onText, abortSignal }: AgentRunOptions,
): Promise<{ text: string; toolCalls: AgentToolEvent[] }> {
  const agent = createSwaleAgent(ctx);
  const toolCalls: AgentToolEvent[] = [];

  /*
   * streamText's default error handler is a hardcoded console.error(error) and
   * ToolLoopAgent.stream takes no onError to replace it, so a recoverable
   * refusal dumps a full stack trace — through the middle of the Ink frame, in
   * the dashboard. The same error is read off fullStream below and reported
   * properly, so muting it here loses nothing.
   */
  const realConsoleError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await agent.stream({
      messages,
      abortSignal,
      onToolExecutionStart: ({ toolCall }) => {
        const event = { name: toolCall.toolName, input: toolCall.input };
        toolCalls.push(event);
        onToolCall?.(event);
      },
    });
  } catch (error) {
    console.error = realConsoleError;
    throw readableError(error);
  }

  /*
   * fullStream, not textStream: textStream drops error parts on the floor, so
   * a turn the SDK rejected still comes back looking like a normal answer.
   */
  let text = "";
  let failure: unknown = null;

  try {
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        text += part.text;
        onText?.(part.text);
      } else if (part.type === "error") {
        failure = part.error;
      }
    }
  } finally {
    console.error = realConsoleError;
  }

  if (failure) throw readableError(failure);

  return { text, toolCalls };
}
