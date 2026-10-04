// library imports
import React from "react";
import { render } from "ink";
// local imports
import { App } from "./App.js";
import { resolveAgentContext } from "../core/agent.js";
import { getLlmDetails, parsePackageJsonContents } from "../core/utils.js";

/**
 * Ink needs a real terminal to draw into. Piping `swale` somewhere should not
 * dump escape codes into a file, so that case falls back to the plain summary.
 */
export async function renderDashboard(): Promise<void> {
  if (!process.stdout.isTTY) {
    const { printPlainDashboard } = await import("./plain.js");
    await printPlainDashboard();
    return;
  }

  /*
   * Wipe the screen and the scrollback once, so the dashboard starts at the top
   * of a clean terminal instead of underneath whatever was already there.
   *
   * 2J clears what is visible, 3J clears the scrollback above it, H parks the
   * cursor at the top. Without 3J the old output is still one scroll away and
   * the app looks like it is halfway down a page.
   */
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");

  const ctx = resolveAgentContext();
  const version = parsePackageJsonContents().version;

  // No model configured means the input box would only ever error.
  const chatReady = Boolean(getLlmDetails());

  const instance = render(<App ctx={chatReady ? ctx : null} version={version} />);
  await instance.waitUntilExit();
}
