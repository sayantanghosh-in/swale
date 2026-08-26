import { program } from "commander";
import readline from "readline/promises";
import { select } from "@inquirer/prompts";
import { SWALE_GITHUB_ISSES_LINK } from "./core/constants.js";
import { executeExpenseAction } from "./core/expenses/utils.js";
import { type SupportedCurrencies, type TodoAction, type UserRecord } from "./core/models.js";
import { executeNoteAction } from "./core/notes/utils.js";
import { executeTodoAction } from "./core/todos/utils.js";
import { createUserObject, getFirstUser, insertUser } from "./core/users/main.js";
import { parsePackageJsonContents } from "./core/utils.js";

const packageJsonContents = parsePackageJsonContents();

// Registering the program
program
  .name(packageJsonContents?.name)
  .description(packageJsonContents?.description)
  .version(packageJsonContents?.version)
  .hook("preSubcommand", async () => {
    const firstUserResult = getFirstUser();
    let userCount: number = 0;

    if (!!firstUserResult?.id) {
      console.log(`Welcome back ${firstUserResult.name}!\n`);
      return;
    }

    /**
     * if a user exists, display a greeting.
     * @TODO - this will be replaced with a password
     * based authentication later.
     */
    if (userCount > 0) {
      console.log(`Welcome back ${firstUserResult?.name}!`);
    }

    let name: string = "";
    let email: string = "";
    let phone: string = "";

    /**
     * Keep on asking for the details from the user because without a user,
     * no operation is permitted in the tool.
     */
    while (userCount === 0 && !name && !email && !phone) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      name = await rl.question("Name: ");
      email = await rl.question("Email: ");
      phone = await rl.question("Phone (with country code): ");
      rl.close();

      const selectedCurrency = (await select({
        message: "Select a currency:",
        choices: ["INR", "USD", "EUR", "GBP", "Other"].map((currency) => {
          return {
            name: currency,
            value: currency,
          };
        }),
      })) as SupportedCurrencies;

      // create and validate the user object based on the user input
      const createUserObjectResult = createUserObject(name, email, phone, selectedCurrency);

      if (createUserObjectResult.success && !!createUserObjectResult?.userObj?.id) {
        const insertUserResult = insertUser(createUserObjectResult.userObj);
        if (insertUserResult.success) {
          console.log(
            `${createUserObjectResult.userObj.name}, you have been added successfully...`,
          );
        } else {
          console.error(
            `We had a issue on our end. Please report the issue here: ${SWALE_GITHUB_ISSES_LINK}`,
          );
        }
      } else {
        console.error(
          "The user could not be created... Please ensure all the entered fields are valid.",
        );
      }
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
      executeExpenseAction(
        action,
        (firstUserResult as UserRecord).id,
        (firstUserResult as UserRecord).currency,
        expenseId,
      );
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
