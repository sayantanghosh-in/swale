#!/usr/bin/env node
import { program } from "commander";
import readline from "readline/promises";
import { select } from "@inquirer/prompts";
import { SWALE_GITHUB_ISSES_LINK } from "./core/constants.js";
import { executeExpenseAction } from "./core/expenses/utils.js";
import { type SupportedCurrencies, type TodoAction, type UserRecord } from "./core/models.js";
import { executeNoteAction } from "./core/notes/utils.js";
import { executeTodoAction } from "./core/todos/utils.js";
import { createUserObject, getFirstUser, insertUser } from "./core/users/main.js";
import { createOrUpdateConfig, parsePackageJsonContents, readConfig } from "./core/utils.js";
// library imports
import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";
import { getOctokit } from "./core/octokit.js";
import { createConnectionsObject, insertConnection } from "./core/connections/main.js";

const auth = createOAuthDeviceAuth({
  clientType: "oauth-app",
  clientId: "Ov23liJbUgcPQV2hYKX0",
  scopes: ["read:user", "user:email"],
  onVerification(verification) {
    // verification example
    // {
    //   device_code: "3584d83530557fdd1f46af8289938c8ef79f9dc5",
    //   user_code: "WDJB-MJHT",
    //   verification_uri: "https://github.com/login/device",
    //   expires_in: 900,
    //   interval: 5,
    // };

    console.log("Open %s", verification.verification_uri);
    console.log("Enter code: %s", verification.user_code);
  },
});

const packageJsonContents = parsePackageJsonContents();

// Registering the program
program
  .name(packageJsonContents?.name)
  .description(packageJsonContents?.description)
  .version(packageJsonContents?.version)
  .hook("preSubcommand", async () => {
    const configData = readConfig();
    if (configData === "ERROR_CONFIG_NOT_SET" || !JSON.parse(configData as string)?.token) {
      // ask user to login to their github account
      const tokenAuthentication = await auth({
        type: "oauth",
      });
      // resolves with
      // {
      //   type: "token",
      //   tokenType: "oauth",
      //   clientType: "oauth-app",
      //   clientId: "1234567890abcdef1234",
      //   token: "...", /* the created oauth token */
      //   scopes: [] /* depend on request scopes by OAuth app */
      // }
      createOrUpdateConfig(tokenAuthentication);

      // get the Octokit instance
      const oc = getOctokit({ auth: tokenAuthentication?.token });
      if (!oc) {
        console.error("ERROR_UNKNOWN_AUTH_ERROR");
        return;
      }
      // get the user details and set it to the users table
      const res = await oc.request("/user", {
        headers: {
          "X-GitHub-Api-Version": "2026-03-10",
        },
      });

      // create the user
      const name = res?.data?.name || res?.data?.login; // if name is private, use the username
      const email = res?.data?.email;
      const createUserObjectResult = createUserObject(name, email);

      if (createUserObjectResult.success && !!createUserObjectResult?.userObj?.id) {
        const insertUserResult = insertUser(createUserObjectResult.userObj);
        if (insertUserResult.success) {
          // create the connection record and link the user to that connection
          const login = res?.data?.login;
          const avatarUrl = res?.data?.avatar_url;
          const profileUrl = res?.data?.html_url;
          const linkedTo = createUserObjectResult?.userObj?.id;
          const createConnectionsObjectResult = createConnectionsObject(
            "github",
            login,
            name,
            avatarUrl,
            profileUrl,
            linkedTo,
          );
          if (
            createConnectionsObjectResult?.success &&
            createConnectionsObjectResult?.connectionsObj?.id
          ) {
            const insertConnectionsResult = insertConnection(
              createConnectionsObjectResult?.connectionsObj,
            );
            if (insertConnectionsResult?.success) {
              console.log(
                `${createUserObjectResult.userObj.name}, you have been added successfully...`,
              );
            }
          }
        } else {
          console.error(
            `We had a issue on our end. Please report the issue here: ${SWALE_GITHUB_ISSES_LINK}`,
          );
          process.exit(1);
        }
      } else {
        console.error(
          "The user could not be created... Please ensure all the entered fields are valid.",
        );
      }
    } else {
      // user configuration already present, let them use swale...
      return;
    }
  });

// Registering all the commands
program
  .command("todo")
  .argument("<action>", "add | delete | list | read | update")
  .argument("[todoId]", "the uuid of the todo item")
  .action(async (action: TodoAction, todoId?: string) => {
    const firstUserResult = getFirstUser();
    if (firstUserResult?.id) {
      executeTodoAction(action, (firstUserResult as UserRecord).id, todoId);
    } else {
      console.error("ERROR_NO_USER_FOUND");
    }
  });

program
  .command("expense")
  .argument("<action>", "add | delete | filter | list | read | update")
  .argument("[expenseId]", "the uuid of the note item")
  .action(async (action: TodoAction, expenseId?: string) => {
    const firstUserResult = getFirstUser();
    if (firstUserResult?.id) {
      let currency = null;
      if (!firstUserResult?.currency) {
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
        currency = firstUserResult?.currency as SupportedCurrencies;
      }
      executeExpenseAction(action, (firstUserResult as UserRecord).id, currency, expenseId);
    } else {
      console.error("ERROR_NO_USER_FOUND");
    }
  });

program
  .command("note")
  .argument("<action>", "add | delete | list | read | update")
  .argument("[noteId]", "the uuid of the note item")
  .action(async (action: TodoAction, noteId?: string) => {
    const firstUserResult = getFirstUser();
    if (firstUserResult?.id) {
      executeNoteAction(action, (firstUserResult as UserRecord).id, noteId);
    } else {
      console.error("ERROR_NO_USER_FOUND");
    }
  });

await program.parseAsync();
