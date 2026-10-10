// library imports
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import type { ModelMessage } from "ai";
// node imports
import { basename } from "node:path";
// local imports
import {
  COLORS,
  PALETTE_ROWS,
  PROFILE_ROLES,
  SCHEDULE_RECHECK_MS,
  SLASH_COMMANDS,
  SLASH_GROUPS,
  type SlashCommand,
} from "../core/constants.js";
import type {
  AgentContext,
  Attachment,
  DashboardSnapshot,
  DisplayBlock,
  Profile,
  Skill,
  SkillData,
} from "../core/models.js";
import { resolveAgentContext } from "../core/agent.js";
import { findSkill, installSkill, loadSkills, removeSkill } from "../core/skills/main.js";
import { chatSkillPrompt, runSkillData, writeCommentary } from "../core/skills/runner.js";
import { recordRun, runDueSkills, scheduleOverview, todaysRuns } from "../core/scheduler/main.js";
import { dueRevisions } from "../core/revisions/main.js";
import {
  addMemory,
  forgetMemory,
  getProfile,
  listMemories,
  setProfileField,
} from "../core/profile/main.js";
import { addRepos, lastCommits, listRepos, removeRepo } from "../core/repos/main.js";
import { generateCard } from "../core/card/main.js";
import { formatBytes } from "../core/attachments.js";
import { runAgent } from "../core/agent.js";
import { getCachedDashboard, getDashboardSnapshot, listLocalModels } from "../core/services.js";
import {
  copyToClipboard,
  daysSince,
  describeLlm,
  getLlmDetails,
  openInBrowser,
  setLlmModel,
} from "../core/utils.js";
import { renderMarkdown, splitCommittable } from "./markdown.js";
import { fitDashboard, wrappedHeight } from "./dashboard.js";
import { Composer } from "./Composer.js";

type Turn = {
  id: number;
  role: "user" | "assistant" | "system" | "tool" | "block";
  text: string;
  /** "info" is swale answering a slash command; "warn" is something going wrong. */
  tone?: "info" | "warn";
  files?: string[];
};

/** Badge row + three box rows + hint line. Fixed, by construction. */
const COMPOSER_ROWS = 5;

/**
 * Rows held above the prompt for the slash palette, attachments and the
 * paragraph currently streaming.
 *
 * Reserved whether or not anything is in them. Letting the block size itself
 * is what made the prompt jump up the screen the moment a `/` was deleted:
 * Ink anchors its live frame at the top, so anything that changes height
 * above the prompt moves the prompt.
 */
const OVERLAY_ROWS = 4;

/** The live frame never shrinks below this, so the prompt never moves. */
const LIVE_ROWS = OVERLAY_ROWS + COMPOSER_ROWS;

type AppProps = {
  ctx: AgentContext | null;
  version: string;
};

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/**
 * How many rows a turn will occupy once written.
 *
 * Needed before it is drawn, to work out how much blank space should sit
 * between the conversation and the prompt. It has to track TurnView below:
 * the padding, the blank line that opens a user turn, and the fact that long
 * lines wrap.
 */
function turnHeight(turn: Omit<Turn, "id">, columns: number): number {
  const inner = Math.max(1, columns - 2); // paddingX={1}
  if (turn.role === "user") return 2 + (turn.files?.length ?? 0); // + marginTop
  if (turn.role === "tool") return 1;
  if (turn.role === "block") return 1 + wrappedHeight(turn.text, inner); // + marginTop
  if (turn.role === "system") return wrappedHeight(`  ${turn.text}`, inner);
  return wrappedHeight(renderMarkdown(turn.text), inner);
}

/** One exchange. Rendered once into scrollback, so it must not depend on live state. */
function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text>
          <Text bold color={COLORS.ORANGE}>
            ›{" "}
          </Text>
          <Text>{turn.text}</Text>
        </Text>
        {turn.files?.map((file) => (
          <Text key={file} color="gray">
            {"  "}📎 {file}
          </Text>
        ))}
      </Box>
    );
  }

  // Something a tool or skill drew: printed exactly as rendered.
  if (turn.role === "block") {
    return (
      <Box paddingX={1} marginTop={1}>
        <Text>{turn.text}</Text>
      </Box>
    );
  }

  if (turn.role === "tool") {
    return (
      <Box paddingX={1}>
        <Text color="gray" dimColor>
          {"  "}⚙ {turn.text}
        </Text>
      </Box>
    );
  }

  if (turn.role === "system") {
    const warn = turn.tone !== "info";
    return (
      // Indent the whole block, not just its first line.
      <Box paddingX={1}>
        <Text color={warn ? "yellow" : "gray"}>{warn ? "! " : "  "}</Text>
        <Text color={warn ? "yellow" : "gray"}>{turn.text}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>{renderMarkdown(turn.text)}</Text>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export function App({ ctx, version }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [history, setHistory] = useState<Turn[]>([]);
  const [tail, setTail] = useState("");
  const [thinking, setThinking] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [llm, setLlm] = useState(() => describeLlm(getLlmDetails()));
  // The dashboard pre-rendered to a string, plus its height. See the effect below.
  const [dash, setDash] = useState<{ text: string; height: number } | null>(null);
  // Skills are files on disk; reloaded after /skills add or remove.
  const [skills, setSkills] = useState<Skill[]>(() => loadSkills());
  const [paletteIndex, setPaletteIndex] = useState(0);

  // Derived before the effects below, which size themselves against the terminal.
  const width = stdout?.columns || 80;
  const rows = stdout?.rows || 24;
  const narrow = width < 76;

  const transcript = useRef<ModelMessage[]>([]);
  /*
   * Prompts wait their turn rather than being refused.
   *
   * The queue lives in a ref because the worker reads it from inside its own
   * completion handler, where a state value would be the one captured when
   * the turn started.
   */
  /*
   * `prompt` is what the transcript shows; `content` is what the model gets,
   * when they differ — a chat skill shows "/interview graphs" but sends the
   * skill's whole recipe. `activeTools` limits that turn to the skill's tools.
   */
  const queue = useRef<
    { prompt: string; files: string[]; content?: string; activeTools?: string[] }[]
  >([]);
  const [queued, setQueued] = useState(0);
  // Rows the conversation has already taken, so the filler can give them back.
  const [contentRows, setContentRows] = useState(0);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const pump = useRef<() => void>(() => {});
  // Sent prompts, newest last. `cursor` walks backwards through them; -1 means
  // "not browsing", so typing is never interrupted by a stale recall.
  const prompts = useRef<string[]>([]);
  const promptCursor = useRef(-1);
  const buffer = useRef("");
  // How much of `buffer` has already been handed to <Static>.
  const committed = useRef(0);
  const lastAnswer = useRef("");
  const nextId = useRef(0);
  const makeId = () => (nextId.current += 1);

  const push = useCallback(
    (turn: Omit<Turn, "id">) => {
      setHistory((prev) => [...prev, { ...turn, id: makeId() }]);
      setContentRows((prev) => prev + turnHeight(turn, width));
    },
    [width],
  );

  const recallPrevious = useCallback(() => {
    if (!prompts.current.length) return null;
    const next = promptCursor.current < 0 ? prompts.current.length - 1 : promptCursor.current - 1;
    if (next < 0) return null;
    promptCursor.current = next;
    return prompts.current[next] ?? null;
  }, []);

  const recallNext = useCallback(() => {
    if (promptCursor.current < 0) return null;
    const next = promptCursor.current + 1;
    if (next >= prompts.current.length) {
      promptCursor.current = -1;
      return "";
    }
    promptCursor.current = next;
    return prompts.current[next] ?? null;
  }, []);

  /*
   * Draw from the cache at once, refresh behind it.
   *
   * The dashboard goes into <Static>, which is written once and never redrawn,
   * so the fresh copy is not swapped in — it is saved for the next launch.
   * Only a first run with nothing cached waits for the network.
   */
  useEffect(() => {
    let cancelled = false;
    const cached = getCachedDashboard();
    if (cached) setSnapshot(cached);
    getDashboardSnapshot()
      .then((result) => !cancelled && !cached && setSnapshot(result))
      .catch(() => !cancelled && !cached && setSnapshot(null));
    return () => {
      cancelled = true;
    };
  }, []);

  /** A fresh agent context per use: profile and memories can change mid-session. */
  const freshCtx = useCallback(
    (openLinks = false): AgentContext | null => {
      const base = resolveAgentContext() ?? ctx;
      if (!base) return null;
      return {
        ...base,
        openLinks,
        emit: (block: DisplayBlock) => push({ role: "block", text: block.text }),
      };
    },
    [ctx, push],
  );

  /** Draws a skill's data, then adds the model's few lines when they arrive. */
  const showSkillData = useCallback(
    async (skill: Skill, data: SkillData, withCommentary: boolean, context: AgentContext) => {
      for (const block of data.blocks) push({ role: "block", text: block.text });
      if (!data.blocks.length && data.facts)
        push({ role: "system", tone: "info", text: data.facts });
      if (!withCommentary) return null;
      const commentary = await writeCommentary(skill, context, data);
      if (commentary) push({ role: "assistant", text: commentary });
      return commentary;
    },
    [push],
  );

  /*
   * Today: run whatever is due, once, when the dashboard first appears — and
   * again every few minutes while it stays open. There is no background
   * process; this is swale's own process, checking while it is awake.
   */
  const ranToday = useRef(false);
  const runToday = useCallback(
    async (announce: boolean) => {
      const context = freshCtx();
      if (!context) return;
      if (!announce) {
        await runDueSkills(context, {
          onData: (_skill, data) => {
            for (const block of data.blocks) push({ role: "block", text: block.text });
          },
          onCommentary: (_skill, text) => push({ role: "assistant", text }),
        });
        return;
      }
      const pending = dueRevisions(context.userId).length;
      const profile = getProfile(context.userId);
      const lines = [
        pending ? `🔁 ${pending} LeetCode revision${pending === 1 ? "" : "s"} due — /revise` : "",
        !profile.role ? "👋 Tell swale about yourself: /profile set role student" : "",
      ].filter(Boolean);
      if (lines.length) push({ role: "system", tone: "info", text: lines.join("\n") });

      await runDueSkills(context, {
        onData: (skill, data) => {
          for (const block of data.blocks) push({ role: "block", text: block.text });
        },
        onCommentary: (_skill, text) => push({ role: "assistant", text }),
      });
    },
    [freshCtx, push],
  );

  // Through a ref, so the timer always calls the current version.
  const todayRef = useRef(runToday);
  useEffect(() => {
    todayRef.current = runToday;
  }, [runToday]);

  useEffect(() => {
    if (!dash || ranToday.current) return;
    ranToday.current = true;
    void todayRef.current(true);
    const timer = setInterval(() => void todayRef.current(false), SCHEDULE_RECHECK_MS);
    return () => clearInterval(timer);
  }, [dash !== null]);

  /*
   * Ctrl+Y copies the last answer.
   *
   * Selecting text with the mouse is the terminal's job, not this app's —
   * capturing the mouse to implement copy-on-select would take native
   * selection and scrollback away, which is a bad trade. This covers the
   * common case without touching either.
   */
  /*
   * Pre-render the dashboard to a string, once, off the render path.
   *
   * Its height has to be known before layout, to size the gap that pushes the
   * prompt to the bottom of the screen — a string can be counted where a
   * component cannot. tui/dashboard.ts has the rest of the reasoning.
   */
  useEffect(() => {
    if (!snapshot) return;
    // One row is held back so the closing newline has somewhere to land.
    setDash(fitDashboard(snapshot, version, narrow, rows - LIVE_ROWS - 1, width));
  }, [snapshot, version, narrow, rows, width]);

  useInput((input, key) => {
    /*
     * Escape means "stop what you are doing" while something is running, and
     * "leave" when nothing is. Aborting does not touch the queue — the worker
     * picks up the next prompt as soon as this one unwinds.
     */
    if (key.escape) {
      if (busy.current) {
        abort.current?.abort();
        return;
      }
      exit();
      return;
    }
    if (key.ctrl && input === "y") {
      if (!lastAnswer.current) return;
      push({
        role: "system",
        tone: "info",
        text: copyToClipboard(lastAnswer.current)
          ? "Last answer copied to the clipboard."
          : "Could not reach a clipboard tool on this system.",
      });
    }
  });

  /** Every slash command: the fixed ones, then one per skill, from its own frontmatter. */
  const commands = useMemo<SlashCommand[]>(
    () => [
      ...SLASH_COMMANDS,
      ...skills.map((skill) => ({
        name: `/${skill.name}`,
        args: skill.args,
        description: skill.description,
        group: skill.group,
      })),
    ],
    [skills],
  );

  const info = useCallback((text: string) => push({ role: "system", tone: "info", text }), [push]);

  /** Returns true when the input was a command and should not reach the agent. */
  const runSlashCommand = useCallback(
    async (raw: string): Promise<boolean> => {
      const [command, ...rest] = raw.trim().split(/\s+/);
      if (!command?.startsWith("/")) return false;
      const argument = rest.join(" ").trim();
      const [verb = "", ...tail] = rest;
      const remainder = tail.join(" ").trim();
      const context = freshCtx(true);

      switch (command) {
        case "/quit":
        case "/exit":
          exit();
          return true;

        case "/clear":
          transcript.current = [];
          setHistory([]);
          setContentRows(0);
          info("Conversation cleared.");
          return true;

        case "/help": {
          const lines: string[] = [];
          for (const group of SLASH_GROUPS) {
            const inGroup = commands.filter((entry) => entry.group === group);
            if (!inGroup.length) continue;
            lines.push(group);
            for (const entry of inGroup) {
              lines.push(
                `  ${entry.name}${entry.args ? ` ${entry.args}` : ""} — ${entry.description}`,
              );
            }
          }
          info(lines.join("\n"));
          return true;
        }

        case "/model": {
          const config = getLlmDetails();
          if (!config) {
            push({ role: "system", text: "No model configured. Run `swale llm` to set one up." });
            return true;
          }
          if (argument) {
            if (!setLlmModel(argument)) {
              push({ role: "system", text: "Could not save that model." });
              return true;
            }
            setLlm(describeLlm(getLlmDetails()));
            info(`Now using ${argument}.`);
            return true;
          }
          const installed = config.type === "local" ? await listLocalModels(config.baseUrl) : [];
          const lines = [`Using ${config.model} on ${describeLlm(config).provider}.`];
          if (installed.length) {
            lines.push("", "Installed locally:");
            for (const name of installed)
              lines.push(`  ${name === config.model ? "●" : "○"} ${name}`);
            lines.push("", "Switch with /model <name>.");
          } else {
            lines.push("", "Switch with /model <name>, or run `swale llm` to change provider.");
          }
          info(lines.join("\n"));
          return true;
        }
      }

      if (!context) {
        push({ role: "system", text: "Not signed in — run `swale` in a terminal to connect." });
        return true;
      }

      switch (command) {
        case "/profile": {
          if (verb === "set") {
            const [field = "", ...value] = tail;
            if (!["role", "stack", "goal"].includes(field)) {
              info(
                `Usage: /profile set <role|stack|goal> <value>. Roles: ${PROFILE_ROLES.join(", ")}.`,
              );
              return true;
            }
            const result = setProfileField(context.userId, field as keyof Profile, value.join(" "));
            info(result.success ? `Saved your ${field}.` : (result.error ?? "Could not save."));
            return true;
          }
          const profile = getProfile(context.userId);
          info(
            [
              `role   ${profile.role ?? "—"}`,
              `stack  ${profile.stack ?? "—"}`,
              `goal   ${profile.goal ?? "—"}`,
              "",
              "Change with /profile set <role|stack|goal> <value>.",
            ].join("\n"),
          );
          return true;
        }

        case "/memory": {
          if (verb === "add") {
            info(
              addMemory(context.userId, remainder).success ? "Remembered." : "Nothing to remember.",
            );
            return true;
          }
          if (verb === "forget") {
            const result = forgetMemory(context.userId, remainder);
            info(result.success ? `Forgot: ${result.text}` : `Nothing matches "${remainder}".`);
            return true;
          }
          const memories = listMemories(context.userId);
          info(
            memories.length
              ? [
                  ...memories.map((memory, index) => `${index + 1}. ${memory.text}`),
                  "",
                  "/memory forget <n> to remove one.",
                ].join("\n")
              : "Nothing yet. Tell swale something about yourself, or /memory add <text>.",
          );
          return true;
        }

        case "/repos": {
          if (verb === "add") {
            const result = addRepos(context.userId, remainder || ".");
            info(
              result.error ??
                (result.added.length
                  ? `Added ${result.added.length}: ${result.added.map((dir) => basename(dir)).join(", ")}`
                  : "Already added."),
            );
            return true;
          }
          if (verb === "remove") {
            info(
              removeRepo(context.userId, remainder).success
                ? "Removed."
                : `No repo matches "${remainder}".`,
            );
            return true;
          }
          const repos = await lastCommits(listRepos(context.userId));
          info(
            repos.length
              ? repos
                  .map(
                    (repo) =>
                      `${repo.repo.padEnd(24)} ${repo.date ? `${daysSince(repo.date)}d ago` : "no commits"}  ${repo.subject.slice(0, 40)}`,
                  )
                  .join("\n")
              : "No repos yet. /repos add ~/code adds every repository in that folder.",
          );
          return true;
        }

        case "/today": {
          const runs = todaysRuns(context.userId);
          const pending = dueRevisions(context.userId).length;
          if (pending)
            info(`🔁 ${pending} LeetCode revision${pending === 1 ? "" : "s"} due — /revise`);
          for (const run of runs) {
            for (const block of run.blocks) push({ role: "block", text: block.text });
            if (run.commentary) push({ role: "assistant", text: run.commentary });
          }
          if (!runs.length && !pending)
            info("Nothing for today yet. Scheduled skills run when they fall due — see /schedule.");
          return true;
        }

        case "/schedule": {
          if (verb === "run") {
            const skill = findSkill(remainder);
            if (!skill) {
              info(`No skill called ${remainder}.`);
              return true;
            }
            const data = await runSkillData(skill, context);
            recordRun(context.userId, skill, data, null);
            const commentary = await showSkillData(skill, data, true, context);
            if (commentary) recordRun(context.userId, skill, data, commentary);
            return true;
          }
          const rows = scheduleOverview(context.userId);
          info(
            [
              ...rows.map(
                (row) =>
                  `${row.name.padEnd(10)} ${row.schedule.padEnd(15)} ${row.lastRun ? `last ran ${new Date(row.lastRun).toLocaleString()}` : "never run"}${row.due ? "  · due" : ""}`,
              ),
              "",
              "Scheduled skills run when swale opens, and every few minutes while it stays open.",
              "/schedule run <skill> runs one now.",
            ].join("\n"),
          );
          return true;
        }

        case "/skills": {
          if (verb === "add") {
            info("Fetching…");
            const result = await installSkill(remainder);
            if (result.skill) setSkills(loadSkills());
            info(
              result.skill
                ? `Installed /${result.skill.name} — ${result.skill.description}`
                : (result.error ?? "Could not install."),
            );
            return true;
          }
          if (verb === "remove") {
            const result = removeSkill(remainder);
            if (result.success) setSkills(loadSkills());
            info(result.success ? `Removed /${remainder}.` : (result.error ?? "Could not remove."));
            return true;
          }
          info(
            [
              ...skills.map(
                (skill) =>
                  `/${skill.name.padEnd(10)} ${skill.description}${skill.schedule ? `  · ${skill.schedule}` : ""}${skill.source === "installed" ? "  · installed" : ""}`,
              ),
              "",
              "/skills add <github-url> installs one; /skills remove <name> removes it.",
            ].join("\n"),
          );
          return true;
        }

        case "/card": {
          info("Drawing your card…");
          const result = await generateCard(context, verb === "month" ? "month" : "week");
          if (!result.path) {
            push({ role: "system", text: result.error ?? "Could not make the card." });
            return true;
          }
          openInBrowser(result.path);
          info(`Saved to ${result.path}`);
          return true;
        }
      }

      const skill = findSkill(command);
      if (skill) {
        // Chat skills become an ordinary agent turn carrying the skill's recipe.
        if (skill.mode === "chat") {
          queue.current.push({
            prompt: raw.trim(),
            files: [],
            content: chatSkillPrompt(skill, argument),
            activeTools: skill.tools,
          });
          setQueued(queue.current.length);
          pump.current();
          return true;
        }
        push({ role: "user", text: raw.trim() });
        const data = await runSkillData(skill, context, argument);
        await showSkillData(skill, data, true, context);
        return true;
      }

      push({ role: "system", text: `Unknown command ${command}. Try /help.` });
      return true;
    },
    [commands, exit, freshCtx, info, push, showSkillData, skills],
  );

  /** One turn, start to finish. Only the worker calls this. */
  const runTurn = useCallback(
    async ({
      prompt,
      files,
      content,
      activeTools,
    }: {
      prompt: string;
      files: string[];
      content?: string;
      activeTools?: string[];
    }) => {
      /*
       * The prompt is printed here rather than when it was typed. Printing on
       * submit put a queued question into the transcript above the answer
       * that was still streaming, which cut the reply in half.
       */
      push({ role: "user", text: prompt, files });

      const controller = new AbortController();
      abort.current = controller;

      buffer.current = "";
      committed.current = 0;
      setTail("");
      transcript.current.push({ role: "user", content: content ?? prompt });

      /*
       * Drain the buffer on a timer rather than per token, and move anything
       * finished out of the live frame as it goes.
       *
       * Ink repaints its entire live region on every change. Letting a long
       * answer pile up there means erasing and redrawing the whole thing
       * several times a second, which is what made replies stutter. Completed
       * paragraphs go to <Static>, so the live frame stays one paragraph tall
       * no matter how long the answer runs.
       */
      const drain = () => {
        const pending = buffer.current.slice(committed.current);
        const [ready, rest] = splitCommittable(pending);
        if (ready.trim()) {
          committed.current += ready.length + 1;
          push({ role: "assistant", text: ready });
        }
        setTail(rest);
      };
      const tick = setInterval(drain, 90);

      try {
        // Fresh each turn, so a block a tool draws lands in the transcript.
        const context = freshCtx() ?? ctx!;
        const { text } = await runAgent(context, {
          messages: transcript.current,
          activeTools,
          abortSignal: controller.signal,
          onToolCall: ({ name }) => {
            setActiveTool(name);
            // respond_directly is bookkeeping, not work worth reporting.
            if (name !== "respond_directly") push({ role: "tool", text: name });
          },
          onText: (chunk) => {
            buffer.current += chunk;
            // The tool finished the moment prose starts arriving. Leaving the
            // label up made it look like the tool ran through the whole answer.
            if (chunk.trim()) setActiveTool(null);
          },
        });
        /*
         * An aborted stream ends rather than throwing, so the success path has
         * to check too. Without this a stopped turn looked like a completed
         * one that happened to be short.
         */
        if (controller.signal.aborted) {
          const partial = text.slice(committed.current).trim();
          if (partial) push({ role: "assistant", text: partial });
          // Keep a partial answer in the transcript so a follow-up still makes
          // sense; drop the exchange entirely when nothing was said.
          if (text.trim()) transcript.current.push({ role: "assistant", content: text });
          else transcript.current.pop();
          push({ role: "system", tone: "info", text: "Stopped." });
          return;
        }

        transcript.current.push({ role: "assistant", content: text });
        lastAnswer.current = text;

        const remainder = text.slice(committed.current).trim();
        if (remainder) push({ role: "assistant", text: remainder });
        else if (!committed.current) push({ role: "assistant", text: "(no answer)" });
      } catch (error) {
        transcript.current.pop();

        if (controller.signal.aborted) {
          // Whatever arrived before the stop is still worth keeping.
          const partial = buffer.current.slice(committed.current).trim();
          if (partial) push({ role: "assistant", text: partial });
          push({ role: "system", tone: "info", text: "Stopped." });
        } else {
          /*
           * Anything already on screen stays on screen. Dropping it meant the
           * reply appeared as it streamed and then vanished when the turn
           * failed, which reads as a rendering fault rather than a refusal.
           */
          const streamed = buffer.current.slice(committed.current).trim();
          if (streamed) push({ role: "assistant", text: streamed });
          push({
            role: "system",
            text: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        clearInterval(tick);
        abort.current = null;
      }
    },
    [ctx, freshCtx, push],
  );

  /*
   * Takes the next prompt off the queue, then calls itself when that one ends.
   *
   * Reached through a ref so the version running inside a finished turn is the
   * current one, not whichever was captured when that turn started.
   */
  const startNext = useCallback(() => {
    if (busy.current) return;
    const next = queue.current.shift();
    setQueued(queue.current.length);
    if (next === undefined) return;

    busy.current = true;
    setThinking(true);
    void runTurn(next).finally(() => {
      busy.current = false;
      setThinking(false);
      setActiveTool(null);
      setTail("");
      pump.current();
    });
  }, [runTurn]);

  useEffect(() => {
    pump.current = startNext;
  }, [startNext]);

  /*
   * The palette: commands matching what has been typed, while the first word
   * is still being written. At most PALETTE_ROWS fit — the same rows held
   * above the prompt, so opening it never moves the prompt.
   */
  const typedCommand = query.startsWith("/") && !query.includes(" ") ? query : null;
  const matches = typedCommand
    ? commands.filter((entry) => entry.name.startsWith(typedCommand))
    : [];
  const selected = matches.length ? Math.min(paletteIndex, matches.length - 1) : 0;

  useEffect(() => {
    setPaletteIndex(0);
  }, [typedCommand]);

  const palette = matches.length
    ? {
        move: (delta: number) =>
          setPaletteIndex((index) => (index + delta + matches.length) % matches.length),
        complete: () => {
          const pick = matches[selected];
          return pick ? `${pick.name} ` : null;
        },
      }
    : undefined;

  const submit = useCallback(
    async (raw: string) => {
      let prompt = raw.trim();
      // Enter on a half-typed command runs the highlighted one.
      if (
        /^\/\S+$/.test(prompt) &&
        !commands.some((entry) => entry.name === prompt) &&
        matches[selected]
      ) {
        prompt = matches[selected]!.name;
      }
      if (!prompt && !attachments.length) return;

      setQuery("");
      if (prompt) {
        prompts.current.push(prompt);
        promptCursor.current = -1;
      }

      // Slash commands are local and instant, so they jump the queue.
      if (prompt.startsWith("/")) {
        const handled = await runSlashCommand(prompt);
        if (handled) return;
      }

      const files = attachments.map((file) => `${file.name} (${file.kind}, not read yet)`);
      setAttachments([]);

      if (!ctx) {
        push({ role: "user", text: prompt, files });
        push({
          role: "system",
          text: "Not signed in — run `swale` in a terminal to connect.",
        });
        return;
      }

      queue.current.push({ prompt, files });
      setQueued(queue.current.length);
      pump.current();
    },
    [attachments, commands, ctx, matches, push, runSlashCommand, selected],
  );

  if (!snapshot || !dash) {
    return (
      <Box padding={1}>
        <Text color={COLORS.ORANGE}>
          <Spinner type="dots" />
        </Text>
        <Text> Loading your dashboard…</Text>
      </Box>
    );
  }

  /*
   * Blank rows that hold the prompt against the bottom of the screen.
   *
   * These live in the frame rather than in <Static> so they can shrink: as
   * replies accumulate the filler gives its rows back one by one and
   * eventually disappears, instead of sitting there as a permanent hole
   * between the conversation and the prompt.
   *
   * The -1 is the row the closing newline needs; without it the content comes
   * to exactly the terminal height and everything scrolls up by one.
   */
  const fill = Math.max(0, rows - dash.height - contentRows - LIVE_ROWS - 1);

  /*
   * What sits above the prompt. Only ever one of these at a time in practice,
   * and the newest lines win if they would not all fit — whatever is closest
   * to the prompt is what the person is looking at.
   */
  const overlay: React.ReactNode[] = [];

  if (attachments.length) {
    for (const file of attachments) {
      overlay.push(
        <Text key={`file-${file.id}`}>
          <Text color="gray">{file.icon} </Text>
          <Text color="cyan">{basename(file.path)}</Text>
          <Text color="gray">
            {"  "}
            {file.kind} · {formatBytes(file.bytes)} · not read yet
          </Text>
        </Text>,
      );
    }
  }

  if (matches.length) {
    // Scroll the window so the highlighted command is always visible.
    const room = matches.length > PALETTE_ROWS ? PALETTE_ROWS - 1 : PALETTE_ROWS;
    const first = Math.min(Math.max(0, selected - room + 1), Math.max(0, matches.length - room));
    for (const [offset, command] of matches.slice(first, first + room).entries()) {
      const active = first + offset === selected;
      overlay.push(
        <Text key={`cmd-${command.name}`}>
          <Text color={COLORS.ORANGE}>{active ? "› " : "  "}</Text>
          <Text color={COLORS.ORANGE} bold={active}>
            {command.name}
          </Text>
          {command.args ? <Text color="gray"> {command.args}</Text> : null}
          <Text color="gray"> — {command.description}</Text>
        </Text>,
      );
    }
    if (matches.length > room) {
      overlay.push(
        <Text key="cmd-more" color="gray" dimColor>
          {"  "}+{matches.length - room} more · ↑↓ to move · tab to complete
        </Text>,
      );
    }
  }

  if (tail) {
    for (const [index, line] of renderMarkdown(tail).split("\n").entries()) {
      overlay.push(<Text key={`tail-${index}`}>{line}</Text>);
    }
  }

  // Waiting prompts, so a queued question is visible before its turn comes.
  for (const [index, item] of queue.current.entries()) {
    overlay.push(
      <Text key={`queued-${index}`} color="gray" dimColor>
        {"  ⋯ "}
        {item.prompt}
      </Text>,
    );
  }

  if (thinking) {
    overlay.push(
      <Text key="status">
        <Text color={COLORS.ORANGE}>
          <Spinner type="dots" />
        </Text>
        <Text color="gray">
          {" "}
          {activeTool && activeTool !== "respond_directly"
            ? `running ${activeTool}…`
            : tail
              ? "writing…"
              : "thinking…"}
        </Text>
        {queued > 0 ? (
          <Text color="gray" dimColor>
            {"  "}
            {queued} queued
          </Text>
        ) : null}
        <Text color="gray" dimColor>
          {"  esc to stop"}
        </Text>
      </Text>,
    );
  }

  const shown = overlay.slice(-OVERLAY_ROWS);

  /*
   * Everything finished goes through <Static>. Ink writes those rows once and
   * never touches them again, so they become ordinary terminal scrollback —
   * which is what makes the history scroll with the mouse and stay selectable.
   * Only the block below is repainted, and it stays pinned at the bottom.
   */
  const settled: Array<{ key: string; node: React.ReactNode }> = [
    { key: "dashboard", node: <Text>{dash.text}</Text> },
    ...history.map((turn) => ({ key: `turn-${turn.id}`, node: <TurnView turn={turn} /> })),
  ];

  return (
    <Box flexDirection="column" width={width}>
      <Static items={settled}>{(item) => <Box key={item.key}>{item.node}</Box>}</Static>

      {fill > 0 ? <Box height={fill} /> : null}

      {/*
        Fixed-height block above the prompt, with its contents pushed to the
        bottom so they sit against it. minHeight rather than height: a
        multi-line question is allowed to grow the frame, an empty palette is
        not allowed to shrink it.
      */}
      <Box flexDirection="column" minHeight={OVERLAY_ROWS} justifyContent="flex-end" width={width}>
        {shown}
      </Box>

      <Composer
        value={query}
        onChange={setQuery}
        onSubmit={submit}
        attachments={attachments}
        onAttach={(found) => setAttachments((prev) => [...prev, ...found])}
        onClearAttachments={() => setAttachments((prev) => prev.slice(0, -1))}
        recallPrevious={recallPrevious}
        recallNext={recallNext}
        busy={thinking}
        provider={llm.provider}
        model={llm.model}
        width={width}
        palette={palette}
      />
    </Box>
  );
}
