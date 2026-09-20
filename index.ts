#!/usr/bin/env node
import { program } from "commander";
import { select } from "@inquirer/prompts";
import { executeExpenseAction } from "./core/expenses/utils.js";
import { type SupportedCurrencies, type TodoAction, type UserRecord } from "./core/models.js";
import { executeNoteAction } from "./core/notes/utils.js";
import { executeTodoAction } from "./core/todos/utils.js";
import { deactivateAllUsers, getActiveUser } from "./core/users/main.js";
import { parsePackageJsonContents } from "./core/utils.js";
// library imports
import { getLeetcodeProfileDetails, onboarding } from "./core/services.js";

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

// Utility commands

// Show leetcode profile stats
// @TODO - manage presentation of the data
program
  .command("leetcode")
  .alias("lc")
  .argument("[username]", "the username of the leetcode account to be searched")
  .action(async (username?: string) => {
    if (typeof username === "string" && username?.trim()?.length > 0) {
      console.log(await getLeetcodeProfileDetails(username));
    } else {
      // search for an existing leetcode connection for the loggedin user
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

await program.parseAsync();
