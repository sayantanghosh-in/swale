// library imports
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import type { ModelMessage } from "ai";
// node imports
import { basename } from "node:path";
// local imports
import { COLORS, SLASH_COMMANDS } from "../core/constants.js";
import type { AgentContext, Attachment, DashboardSnapshot } from "../core/models.js";
import { formatBytes } from "../core/attachments.js";
import { runAgent } from "../core/agent.js";
import { getDashboardSnapshot, listLocalModels } from "../core/services.js";
import { copyToClipboard, describeLlm, getLlmDetails, setLlmModel } from "../core/utils.js";
import { renderMarkdown, splitCommittable } from "./markdown.js";
import { fitDashboard, wrappedHeight } from "./dashboard.js";
import { Composer } from "./Composer.js";

type Turn = {
  id: number;
  role: "user" | "assistant" | "system" | "tool";
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
      <Box paddingX={1}>
        <Text color={warn ? "yellow" : "gray"}>
          {warn ? "! " : "  "}
          {turn.text}
        </Text>
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
  const queue = useRef<{ prompt: string; files: string[] }[]>([]);
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

  useEffect(() => {
    let cancelled = false;
    getDashboardSnapshot()
      .then((result) => !cancelled && setSnapshot(result))
      .catch(() => !cancelled && setSnapshot(null));
    return () => {
      cancelled = true;
    };
  }, []);

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

  /** Returns true when the input was a command and should not reach the agent. */
  const runSlashCommand = useCallback(
    async (raw: string): Promise<boolean> => {
      const [command, ...rest] = raw.trim().split(/\s+/);
      if (!command?.startsWith("/")) return false;
      const argument = rest.join(" ").trim();

      switch (command) {
        case "/quit":
        case "/exit":
          exit();
          return true;

        case "/clear":
          transcript.current = [];
          setHistory([]);
          setContentRows(0);
          push({ role: "system", tone: "info", text: "Conversation cleared." });
          return true;

        case "/help":
          push({
            role: "system",
            tone: "info",
            text: SLASH_COMMANDS.map(
              (entry) =>
                `${entry.name}${entry.args ? ` ${entry.args}` : ""} — ${entry.description}`,
            ).join("\n"),
          });
          return true;

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
            push({ role: "system", tone: "info", text: `Now using ${argument}.` });
            return true;
          }

          const installed = config.type === "local" ? await listLocalModels(config.baseUrl) : [];
          const lines = [`Using ${config.model} on ${describeLlm(config).provider}.`];
          if (installed.length) {
            lines.push("", "Installed locally:");
            for (const name of installed) {
              lines.push(`  ${name === config.model ? "●" : "○"} ${name}`);
            }
            lines.push("", "Switch with /model <name>.");
          } else {
            lines.push("", "Switch with /model <name>, or run `swale llm` to change provider.");
          }
          push({ role: "system", tone: "info", text: lines.join("\n") });
          return true;
        }

        default:
          push({ role: "system", text: `Unknown command ${command}. Try /help.` });
          return true;
      }
    },
    [exit, push],
  );

  /** One turn, start to finish. Only the worker calls this. */
  const runTurn = useCallback(
    async ({ prompt, files }: { prompt: string; files: string[] }) => {
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
      transcript.current.push({ role: "user", content: prompt });

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
        const { text } = await runAgent(ctx!, {
          messages: transcript.current,
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
    [ctx, push],
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

  const submit = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
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
    [attachments, ctx, push, runSlashCommand],
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

  if (query.startsWith("/")) {
    const typed = query.split(" ")[0] ?? "";
    for (const command of SLASH_COMMANDS.filter((entry) => entry.name.startsWith(typed))) {
      overlay.push(
        <Text key={`cmd-${command.name}`}>
          <Text color={COLORS.ORANGE}>{command.name}</Text>
          {command.args ? <Text color="gray"> {command.args}</Text> : null}
          <Text color="gray"> — {command.description}</Text>
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
      />
    </Box>
  );
}
