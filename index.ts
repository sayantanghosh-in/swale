#!/usr/bin/env node
import { program } from "commander";
import { select } from "@inquirer/prompts";
import { executeExpenseAction } from "./core/expenses/utils.js";
import { formatLastRepositories, formatLeetcodeContributions } from "./core/formatters.js";
import {
  type LeetcodeProfileDetails,
  type SupportedCurrencies,
  type TodoAction,
  type UserRecord,
} from "./core/models.js";
import { executeNoteAction } from "./core/notes/utils.js";
import { executeTodoAction } from "./core/todos/utils.js";
import { deactivateAllUsers, getActiveUser } from "./core/users/main.js";
import { askForLLMDetails, getGithubAuth, parsePackageJsonContents } from "./core/utils.js";
// library imports
import { getLeetcodeProfileDetails, onboarding, streamChat } from "./core/services.js";
import { listRepositories } from "./core/octokit.js";
import { fetchLoginByProvider } from "./core/connections/main.js";
import chalk from "chalk";

const packageJsonContents = parsePackageJsonContents();

// Registering the program
program
  .name(packageJsonContents?.name)
  .description(packageJsonContents?.description)
  .version(packageJsonContents?.version)
  .hook("preSubcommand", onboarding);

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
await program.parseAsync();
