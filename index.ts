#!/usr/bin/env node
import { program } from "commander";
import { select } from "@inquirer/prompts";
import { executeExpenseAction } from "./core/expenses/utils.js";
import {
  formatGithubCalendar,
  formatLastRepositories,
  formatLeetcodeCalendar,
  formatLeetcodeContributions,
} from "./core/formatters.js";
import {
  type LeetcodeProfileDetails,
  type SupportedCurrencies,
  type TodoAction,
  type UserRecord,
} from "./core/models.js";
import { executeNoteAction } from "./core/notes/utils.js";
import { executeTodoAction } from "./core/todos/utils.js";
import { deactivateAllUsers, getActiveUser } from "./core/users/main.js";
import {
  askForLLMDetails,
  fillCalendarWindow,
  leetcodeCalendarToDays,
  parsePackageJsonContents,
} from "./core/utils.js";
import { CALENDAR_WEEKS } from "./core/constants.js";
// library imports
import { getLeetcodeProfileDetails, onboarding, streamChat } from "./core/services.js";
import { getContributionCalendar, listRepositories } from "./core/octokit.js";
import { fetchLoginByProvider } from "./core/connections/main.js";
import { executeBackupAction, executeRestoreAction } from "./core/backup/utils.js";
import { renderDashboard } from "./tui/index.js";
import { loadSkills } from "./core/skills/main.js";
import {
  executeBrief,
  executeCard,
  executeMemory,
  executeProfile,
  executeRepos,
  executeSchedule,
  executeSkillCommand,
  executeSkills,
  executeToday,
} from "./core/skills/utils.js";
import chalk from "chalk";

const packageJsonContents = parsePackageJsonContents();

const printLeetcodeCalendar = (data: LeetcodeProfileDetails): string =>
  formatLeetcodeCalendar(
    fillCalendarWindow(leetcodeCalendarToDays(data?.submissionCalendar ?? {}), CALENDAR_WEEKS * 7),
    data?.activeYears ?? [],
  );

/*
 * Commands that must run before there is an account to run them for. `restore`
 * is the whole point of this list: on a new machine it is the first thing you
 * type, and onboarding would otherwise demand a GitHub sign-in and exit first.
 */
const SKIPS_ONBOARDING = new Set(["restore", "help"]);

// Registering the program
program
  .name("swale")
  .description(packageJsonContents?.description)
  .version(packageJsonContents?.version)
  .hook("preSubcommand", async (_thisCommand, subcommand) => {
    if (SKIPS_ONBOARDING.has(subcommand.name())) return;
    await onboarding();
  });

// Registering all the commands
// Module commands
program
  .command("todo")
  .argument("<action>", "add | delete | list | read | update")
  .argument("[todoId]", "the uuid of the todo item")
  .action(async (action: TodoAction, todoId?: string) => {
    const activeUser = getActiveUser();
    if (activeUser?.id) {
      executeTodoAction(action, (activeUser as UserRecord).id, todoId);
    } else {
      console.error("ERROR_NO_USER_FOUND");
    }
  });

program
  .command("expense")
  .argument("<action>", "add | delete | filter | list | read | update")
  .argument("[expenseId]", "the uuid of the note item")
  .action(async (action: TodoAction, expenseId?: string) => {
    const activeUser = getActiveUser();
    if (activeUser?.id) {
      let currency = null;
      if (!activeUser?.currency) {
        currency = (await select({
          message: "Select a currency:",
          choices: ["INR", "USD", "EUR", "GBP", "Other"].map((currency) => {
            return {
              name: currency,
              value: currency,
            };
          }),
        })) as SupportedCurrencies;
      } else {
        currency = activeUser?.currency as SupportedCurrencies;
      }
      executeExpenseAction(action, (activeUser as UserRecord).id, currency, expenseId);
    } else {
      console.error("ERROR_NO_USER_FOUND");
    }
  });

program
  .command("note")
  .argument("<action>", "add | delete | list | read | update")
  .argument("[noteId]", "the uuid of the note item")
  .action(async (action: TodoAction, noteId?: string) => {
    const activeUser = getActiveUser();
    if (activeUser?.id) {
      executeNoteAction(action, (activeUser as UserRecord).id, noteId);
    } else {
      console.error("ERROR_NO_USER_FOUND");
    }
  });

program
  .command("github")
  .alias("gh")
  .argument("<action>", "sync")
  .option("-n, --limit <count>", "how many repositories to show", "5")
  .action(async (action: "sync", options: { limit: string }) => {
    if (action !== "sync") {
      console.error("ERROR_UNKNOWN_GITHUB_ACTION");
      process.exit(1);
    }

    const activeUser = getActiveUser();
    if (!activeUser?.id) {
      console.error("ERROR_NO_USER_FOUND");
      process.exit(1);
    }

    // Whose repositories to read comes from the signed-in account, never a
    // hardcoded login.
    const githubConnection = fetchLoginByProvider(activeUser.id, "github");
    if (!githubConnection?.success || !githubConnection?.login) {
      console.error("ERROR_NO_GITHUB_CONNECTION");
      process.exit(1);
    }

    const limit = Number.parseInt(options.limit, 10);
    const repositories = await listRepositories(
      githubConnection.login,
      Number.isNaN(limit) ? undefined : limit,
    );

    if (!repositories) {
      console.error("ERROR_GITHUB_SYNC");
      process.exit(1);
    }

    const contributions = await getContributionCalendar(githubConnection.login, CALENDAR_WEEKS * 7);
    if (contributions) {
      const days = fillCalendarWindow(contributions.days, CALENDAR_WEEKS * 7);
      console.log(formatGithubCalendar(days, githubConnection.login));
    }

    console.log(formatLastRepositories(repositories.res?.data));
  });

// Utility commands

// Show leetcode profile stats
// @TODO - manage presentation of the data
program
  .command("leetcode")
  .alias("lc")
  .argument("[username]", "the username of the leetcode account to be searched")
  .action(async (username?: string) => {
    if (typeof username === "string" && username?.trim()?.length > 0) {
      const leetcodeData: LeetcodeProfileDetails = await getLeetcodeProfileDetails(username);
      console.log(formatLeetcodeContributions(leetcodeData, username));
      console.log(printLeetcodeCalendar(leetcodeData));
    } else {
      // search for an existing leetcode connection for the loggedin user
      const activeUser = getActiveUser();
      if (activeUser?.id) {
        const leetcodeConnectionResponse = fetchLoginByProvider(activeUser?.id, "leetcode");
        if (!leetcodeConnectionResponse?.success) {
          console.error("ERROR_LEETCODE_CONNECTION");
        } else {
          const username = leetcodeConnectionResponse?.login;
          const leetcodeData: LeetcodeProfileDetails = await getLeetcodeProfileDetails(username);
          console.log(formatLeetcodeContributions(leetcodeData, username));
          console.log(printLeetcodeCalendar(leetcodeData));
        }
      } else {
        console.error("ERROR_NO_USER_FOUND");
      }
    }
  });

// Make all users inactive
program
  .command("logout")
  .alias("signout")
  .action(async () => {
    const deactivatAlleUsersResponse = deactivateAllUsers();
    if (deactivatAlleUsersResponse?.success) {
      console.log("Logged out successfully...");
    } else {
      console.error(deactivatAlleUsersResponse?.error);
    }
  });

// Data portability
program
  .command("backup")
  .argument("[directory]", "where to write the archive (defaults to ~/.swale/backups)")
  .description("Zip up your swale data so you can move it to another machine")
  .action(async (directory?: string) => {
    await executeBackupAction(directory);
  });

program
  .command("restore")
  .argument("<zipPath>", "path to a zip produced by `swale backup`")
  .description("Replace the data on this machine with the contents of a backup")
  .action(async (zipPath: string) => {
    await executeRestoreAction(zipPath);
  });

// AI commands
program.command("llm").action(async () => {
  const status = await askForLLMDetails();
  if (!status) {
    console.error("Something is wrong in the LLM configuration");
  } else {
    console.log(chalk.cyan("🚀 LLM connected successfully..."));
  }
});

program
  .command("chat")
  .alias("c")
  .action(async () => {
    streamChat();
  });
/*
 * Bare `swale` with no subcommand opens the dashboard. Registered as the
 * default command so commander still runs the preSubcommand onboarding hook —
 * checking argv by hand here would skip it.
 */
// v1.0.0 — you, skills and schedule
program
  .command("profile")
  .argument("[args...]", "set <role|stack|goal> <value>")
  .description("Your role, stack and goal")
  .action(async (args: string[]) => executeProfile(args));

program
  .command("memory")
  .argument("[args...]", "add <text> | forget <n>")
  .description("What swale remembers about you")
  .action(async (args: string[]) => executeMemory(args));

program
  .command("repos")
  .argument("[args...]", "add|remove <path>")
  .description("Local git folders swale can read")
  .action(async (args: string[]) => executeRepos(args));

program
  .command("today")
  .description("This period's scheduled results and due revisions")
  .action(async () => executeToday());

program
  .command("brief")
  .option("--run", "also run anything due (numbers only, no model)")
  .description("One line for your shell startup: what is due and ready")
  .action(async (options: { run?: boolean }) => executeBrief(options));

program
  .command("schedule")
  .argument("[verb]", "run <skill> | run-due")
  .argument("[skill]")
  .description("What runs when; run one now")
  .action(async (verb?: string, skill?: string) => executeSchedule(verb, skill));

program
  .command("skills")
  .argument("[verb]", "add <github-url> | remove <name>")
  .argument("[target]")
  .description("Installed skills")
  .action(async (verb?: string, target?: string) => executeSkills(verb, target));

program
  .command("card")
  .argument("[period]", "week | month")
  .description("Make a shareable image of your progress")
  .action(async (period?: string) => executeCard(period));

/*
 * One command per skill, read from the skills on disk — so installing a skill
 * adds `swale <its-name>` as well as `/its-name`. A skill whose name clashes
 * with a built-in command is left as a slash command only.
 */
const taken = new Set(
  program.commands.flatMap((command) => [command.name(), ...command.aliases()]),
);
for (const skill of loadSkills()) {
  if (taken.has(skill.name)) continue;
  program
    .command(skill.name)
    .argument("[args...]", skill.args ?? "")
    .description(skill.description)
    .action(async (args: string[]) => executeSkillCommand(skill, args));
}

program
  .command("dashboard", { isDefault: true })
  .description("Your calendars, your numbers, and a prompt to ask about them")
  .action(async () => {
    await renderDashboard();
  });

await program.parseAsync();
