// library imports
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput, usePaste } from "ink";
// local imports
import { CLIPBOARD_POLL_MS, COLORS } from "../core/constants.js";
import { describeAttachment, parsePastedAttachments } from "../core/attachments.js";
import { clipboardImageType, saveClipboardImage } from "../core/clipboard.js";
import type { Attachment } from "../core/models.js";

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  attachments: Attachment[];
  onAttach: (attachments: Attachment[]) => void;
  onClearAttachments: () => void;
  recallPrevious: () => string | null;
  recallNext: () => string | null;
  /** The agent is working. Typing stays open; this only changes what is shown. */
  busy: boolean;
  provider: string;
  model: string;
  width: number;
  /** Set while the slash palette is open: arrows move its selection and tab completes. */
  palette?: { move: (delta: number) => void; complete: () => string | null };
};

export function Composer({
  value,
  onChange,
  onSubmit,
  attachments,
  onAttach,
  onClearAttachments,
  recallPrevious,
  recallNext,
  busy,
  provider,
  model,
  width,
  palette,
}: ComposerProps) {
  const [cursor, setCursor] = useState(value.length);
  const [clipboardImage, setClipboardImage] = useState<string | null>(null);
  const imageCount = useRef(0);

  const at = Math.min(cursor, value.length);
  const setBoth = (next: string, nextCursor: number) => {
    onChange(next);
    setCursor(Math.max(0, Math.min(nextCursor, next.length)));
  };
  const insert = (text: string) =>
    setBoth(value.slice(0, at) + text + value.slice(at), at + text.length);

  /*
   * Watch the clipboard for a picture.
   *
   * Cmd+V cannot deliver one: the terminal turns a paste into keystrokes, and
   * an image has none. So swale asks the OS every couple of seconds whether a
   * picture is sitting there and offers to take it.
   */
  useEffect(() => {
    // Nothing to attach to while the agent is working, and the poll is the
    // most expensive thing in the loop, so it waits.
    if (busy) return;

    let stopped = false;
    let inFlight = false;

    const look = async () => {
      // Skip if the previous poll is still out: osascript can take a second
      // under contention and overlapping calls make that worse.
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const found = await clipboardImageType();
        if (!stopped) setClipboardImage(found);
      } catch {
        if (!stopped) setClipboardImage(null);
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(look, CLIPBOARD_POLL_MS);
    const first = setTimeout(look, 400);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(first);
    };
  }, [busy]);

  const attachClipboardImage = () => {
    // Fire and forget: reading the image shells out, and blocking a keypress
    // on that is what made the composer feel sticky in the first place.
    void saveClipboardImage()
      .then((saved) => {
        const described = saved ? describeAttachment(saved) : null;
        if (!described) {
          setClipboardImage(null);
          return;
        }
        imageCount.current += 1;
        onAttach([described]);
        // Claude-style inline token, so the prompt reads as a sentence.
        insert(`[Image #${imageCount.current}] `);
      })
      .catch(() => setClipboardImage(null));
  };

  usePaste((text) => {
    const { attachments: found, remainder } = parsePastedAttachments(text);
    if (found.length) {
      onAttach(found);
      // The path itself goes into the prompt — that is what the person pasted,
      // and it is what they will refer to.
      insert(found.map((file) => file.path).join(" ") + " ");
    }

    const rest = remainder.replace(/\r/g, "");
    if (rest) insert(rest);
  });

  useInput(
    (input, key) => {
      if (key.return && !key.shift) {
        if (value.trim().length || attachments.length) onSubmit(value);
        return;
      }
      if ((key.return && key.shift) || (key.ctrl && input === "j")) {
        insert("\n");
        return;
      }

      // Ctrl+V only matters for pictures; text paste arrives through usePaste.
      if (key.ctrl && input === "v") {
        attachClipboardImage();
        return;
      }

      if (key.backspace || key.delete) {
        if (!value.length && attachments.length) {
          onClearAttachments();
          return;
        }
        if (at > 0) setBoth(value.slice(0, at - 1) + value.slice(at), at - 1);
        return;
      }

      /*
       * Up on an empty line recalls the last prompt, the way a shell does.
       * With text already typed, up and down move inside it instead — pulling
       * history out from under a half-written question would lose it.
       */
      // With the palette open, the arrows belong to it, not to prompt history.
      if (palette && (key.upArrow || key.downArrow)) {
        palette.move(key.upArrow ? -1 : 1);
        return;
      }
      if (palette && key.tab) {
        const completed = palette.complete();
        if (completed) setBoth(completed, completed.length);
        return;
      }

      if (key.upArrow) {
        if (!value.length) {
          const previous = recallPrevious();
          if (previous !== null) setBoth(previous, previous.length);
          return;
        }
        const lineStart = value.lastIndexOf("\n", at - 1);
        if (lineStart === -1) {
          const previous = recallPrevious();
          if (previous !== null) setBoth(previous, previous.length);
        } else {
          setCursor(Math.max(0, lineStart));
        }
        return;
      }

      if (key.downArrow) {
        const next = recallNext();
        if (next !== null) setBoth(next, next.length);
        return;
      }

      if (key.leftArrow) return setCursor(Math.max(0, at - 1));
      if (key.rightArrow) return setCursor(Math.min(value.length, at + 1));
      if (key.home || (key.ctrl && input === "a")) return setCursor(0);
      if (key.end || (key.ctrl && input === "e")) return setCursor(value.length);

      if (key.ctrl && input === "u") return setBoth(value.slice(at), 0);
      if (key.ctrl && input === "k") return setBoth(value.slice(0, at), at);
      if (key.ctrl && input === "w") {
        const upto = value.slice(0, at).replace(/\S+\s*$/, "");
        return setBoth(upto + value.slice(at), upto.length);
      }

      if (input && !key.ctrl && !key.meta) {
        const clean = input.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
        if (clean) setBoth(value.slice(0, at) + clean + value.slice(at), at + clean.length);
      }
    },
    { isActive: true },
  );

  const head = value.slice(0, at);
  const cursorChar = value.slice(at, at + 1) || " ";
  const tail = value.slice(at + 1);

  /*
   * The hints have to fit on one line. Wrapped, they cost a second row, the
   * content comes to exactly the terminal height, and the top of the banner
   * scrolls away — so the longest version that fits is the one shown.
   */
  const hint =
    (busy
      ? [
          "enter queues · ctrl+j newline · ↑ last prompt · ctrl+y copy reply · esc stop",
          "enter queues · ctrl+j newline · ↑ history · esc stop",
          "enter queues · esc stop",
        ]
      : [
          "enter send · ctrl+j newline · ↑ last prompt · ctrl+y copy reply · /help · esc quit",
          "enter send · ctrl+j newline · ↑ history · /help · esc quit",
          "enter send · /help · esc quit",
        ]
    ).find((candidate) => candidate.length <= width - 2) ?? "esc quit";

  /*
   * Exactly five rows when the input is one line: badge, three box rows, hints.
   * The slash palette and the attachment list are rendered by App, above this,
   * inside a reserved block — drawn from here they changed this component's
   * height as they came and went, and the whole prompt jumped up the screen.
   */
  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="flex-end" paddingRight={1}>
        {clipboardImage ? (
          // Collapses when there is no room: this row must never wrap, or the
          // composer costs an extra line and the banner scrolls off the top.
          <Text color="cyan">
            {width >= 86 ? `🖼 ${clipboardImage} in clipboard — ctrl+v to attach` : "🖼 ctrl+v"}
            <Text color="gray"> │ </Text>
          </Text>
        ) : null}
        <Text color="gray">
          {provider} <Text color={COLORS.ORANGE}>·</Text> {model}
        </Text>
      </Box>

      <Box width={width} borderStyle="round" borderColor={COLORS.ORANGE} paddingX={1}>
        <Text color={COLORS.ORANGE}>› </Text>
        <Box flexGrow={1}>
          {value.length === 0 ? (
            <Text>
              <Text inverse> </Text>
              <Text color="gray">Ask about your todos, spending, GitHub…</Text>
            </Text>
          ) : (
            <Text>
              {head}
              <Text inverse>{cursorChar}</Text>
              {tail}
            </Text>
          )}
        </Box>
      </Box>

      <Box paddingX={1}>
        <Text color="gray" dimColor>
          {hint}
        </Text>
      </Box>
    </Box>
  );
}
