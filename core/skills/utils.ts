// library imports
import chalk from "chalk";
// local imports
import { COLORS, PROFILE_ROLES } from "../constants.js";
import type { AgentContext, Profile, Skill } from "../models.js";
import { resolveAgentContext } from "../agent.js";
import { askForProfile, streamChat } from "../services.js";
import { installSkill, loadSkills, removeSkill } from "./main.js";
import { chatSkillPrompt, runSkillData, writeCommentary } from "./runner.js";
import { recordRun, runDueSkills, scheduleOverview, todaysRuns } from "../scheduler/main.js";
import { dueRevisions } from "../revisions/main.js";
import {
  addMemory,
  forgetMemory,
  getProfile,
  listMemories,
  setProfileField,
} from "../profile/main.js";
import { addRepos, lastCommits, listRepos, removeRepo } from "../repos/main.js";
import { generateCard } from "../card/main.js";
import { daysSince, getLlmDetails, openInBrowser } from "../utils.js";

/*
 * The shell side of v1.0.0: every dashboard command also works as
 * `swale <command>`, so it can be scripted, piped, or put in .zshrc.
 */

const context = (openLinks = true): AgentContext => {
  const ctx = resolveAgentContext();
  if (!ctx) {
    console.error("ERROR_NO_USER_FOUND");
    process.exit(1);
  }
  return { ...ctx, openLinks };
};

const printSkill = async (skill: Skill, ctx: AgentContext, args: string, schedule = false) => {
  const data = await runSkillData(skill, ctx, args);
  for (const block of data.blocks) console.log(`${block.text}\n`);
  if (!data.blocks.length && data.facts) console.log(data.facts);
  if (schedule) recordRun(ctx.userId, skill, data, null);
  if (getLlmDetails() && skill.body.trim() && process.stdout.isTTY)
    process.stdout.write(chalk.gray("  writing…\r"));
  const commentary = await writeCommentary(skill, ctx, data);
  if (process.stdout.isTTY) process.stdout.write("            \r");
  if (commentary) console.log(`${commentary}\n`);
  if (schedule && commentary) recordRun(ctx.userId, skill, data, commentary);
};

export async function executeSkillCommand(skill: Skill, args: string[]) {
  const ctx = context();
  const input = args.join(" ");
  if (skill.mode === "chat") {
    await streamChat({ content: chatSkillPrompt(skill, input), activeTools: skill.tools });
    return;
  }
  await printSkill(skill, ctx, input);
}

/** `swale brief`: instant, from what is stored, for a line in .zshrc. */
export async function executeBrief(options: { run?: boolean }) {
  const ctx = context(false);
  const pending = dueRevisions(ctx.userId).length;
  const due = scheduleOverview(ctx.userId).filter((row) => row.due);
  const ready = todaysRuns(ctx.userId).length;
  const parts = [
    pending ? `🔁 ${pending} LeetCode revision${pending === 1 ? "" : "s"} due` : "",
    ready ? `📊 ${ready} update${ready === 1 ? "" : "s"} ready (swale today)` : "",
    due.length ? `⏳ ${due.map((row) => row.name).join(", ")} due` : "",
  ].filter(Boolean);
  console.log(
    parts.length
      ? chalk.hex(COLORS.ORANGE)("swale ") + parts.join(chalk.gray("  ·  "))
      : chalk.gray("swale · all caught up"),
  );

  if (options.run && due.length) {
    // Numbers only, no model: a terminal opening should not wait on an LLM.
    await runDueSkills(ctx, { withCommentary: false });
  }
}

export async function executeToday() {
  const ctx = context(false);
  const pending = dueRevisions(ctx.userId).length;
  if (pending)
    console.log(`🔁 ${pending} LeetCode revision${pending === 1 ? "" : "s"} due — swale revise\n`);
  const runs = todaysRuns(ctx.userId);
  for (const run of runs) {
    for (const block of run.blocks) console.log(`${block.text}\n`);
    if (run.commentary) console.log(`${run.commentary}\n`);
  }
  if (!runs.length && !pending)
    console.log(
      "Nothing for today yet. Scheduled skills run when they fall due — see `swale schedule`.",
    );
}

export async function executeSchedule(verb?: string, name?: string) {
  const ctx = context(false);
  if (verb === "run" && name) {
    const skill = loadSkills().find((entry) => entry.name === name);
    if (!skill) return console.error(`No skill called ${name}.`);
    return printSkill(skill, ctx, "", true);
  }
  if (verb === "run-due") {
    const ran = await runDueSkills(ctx);
    return console.log(
      ran.length ? `Ran ${ran.map((skill) => skill.name).join(", ")}.` : "Nothing due.",
    );
  }
  for (const row of scheduleOverview(ctx.userId)) {
    console.log(
      `${chalk.hex(COLORS.ORANGE)(row.name.padEnd(10))} ${row.schedule.padEnd(15)} ${chalk.gray(row.lastRun ? `last ran ${new Date(row.lastRun).toLocaleString()}` : "never run")}${row.due ? chalk.yellow("  · due") : ""}`,
    );
  }
}

export async function executeSkills(verb?: string, target?: string) {
  if (verb === "add" && target) {
    const result = await installSkill(target);
    return console.log(
      result.skill ? `Installed ${result.skill.name} — ${result.skill.description}` : result.error,
    );
  }
  if (verb === "remove" && target) {
    const result = removeSkill(target);
    return console.log(result.success ? `Removed ${target}.` : result.error);
  }
  for (const skill of loadSkills()) {
    console.log(
      `${chalk.hex(COLORS.ORANGE)(skill.name.padEnd(10))} ${skill.description}${chalk.gray(`${skill.schedule ? `  · ${skill.schedule}` : ""}${skill.source === "installed" ? "  · installed" : ""}`)}`,
    );
  }
}

export async function executeProfile(args: string[]) {
  const ctx = context(false);
  const [verb, field = "", ...value] = args;
  if (verb === "set") {
    if (!["role", "stack", "goal"].includes(field)) {
      return console.error(
        `Usage: swale profile set <role|stack|goal> <value>. Roles: ${PROFILE_ROLES.join(", ")}.`,
      );
    }
    const result = setProfileField(ctx.userId, field as keyof Profile, value.join(" "));
    return console.log(result.success ? `Saved your ${field}.` : result.error);
  }
  if (!verb && process.stdin.isTTY) {
    await askForProfile(ctx.userId);
    return console.log("Saved.");
  }
  const profile = getProfile(ctx.userId);
  console.log(
    `role   ${profile.role ?? "—"}\nstack  ${profile.stack ?? "—"}\ngoal   ${profile.goal ?? "—"}`,
  );
}

export async function executeMemory(args: string[]) {
  const ctx = context(false);
  const [verb, ...rest] = args;
  if (verb === "add")
    return console.log(
      addMemory(ctx.userId, rest.join(" ")).success ? "Remembered." : "Nothing to remember.",
    );
  if (verb === "forget") {
    const result = forgetMemory(ctx.userId, rest.join(" "));
    return console.log(result.success ? `Forgot: ${result.text}` : "No match.");
  }
  const memories = listMemories(ctx.userId);
  console.log(
    memories.length
      ? memories.map((memory, index) => `${index + 1}. ${memory.text}`).join("\n")
      : "Nothing remembered yet.",
  );
}

export async function executeRepos(args: string[]) {
  const ctx = context(false);
  const [verb, target] = args;
  if (verb === "add") {
    const result = addRepos(ctx.userId, target ?? ".");
    return console.log(
      result.error ??
        (result.added.length ? `Added ${result.added.length} repositories.` : "Already added."),
    );
  }
  if (verb === "remove" && target)
    return console.log(removeRepo(ctx.userId, target).success ? "Removed." : "No match.");
  const repos = await lastCommits(listRepos(ctx.userId));
  if (!repos.length)
    return console.log(
      "No repos yet. `swale repos add ~/code` adds every repository in that folder.",
    );
  for (const repo of repos) {
    console.log(
      `${repo.repo.padEnd(24)} ${chalk.gray(repo.date ? `${daysSince(repo.date)}d ago` : "no commits")}  ${repo.subject.slice(0, 50)}`,
    );
  }
}

export async function executeCard(period?: string) {
  const ctx = context();
  const result = await generateCard(ctx, period === "month" ? "month" : "week");
  if (!result.path) return console.error(result.error);
  console.log(`Saved to ${result.path}`);
  if (process.stdout.isTTY) openInBrowser(result.path);
}
