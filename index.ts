import { program } from "commander";
import readline from "readline/promises";
import { SWALE_GITHUB_ISSES_LINK } from "./core/constants.js";
import { createUserObject, getFirstUser, insertUser } from "./core/users/main.js";
import { parsePackageJsonContents } from "./core/utils.js";
import { executeTodoAction } from "./core/todos/utils.js";
import type { TodoAction, UserRecord } from "./core/models.js";

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

      // create and validate the user object based on the user input
      const createUserObjectResult = createUserObject(name, email, phone);

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
      executeTodoAction(action, (firstUserResult as UserRecord).email, todoId);
    } else {
      console.error("ERROR_NO_USER_FOUND");
    }
  });

program
  .command("expense")
  .argument("<action>", "add | delete | list | read | update")
  .action((action: string) => {
    console.log(`Expense called with action: ${action}`);
  });

program
  .command("note")
  .argument("<action>", "add | delete | list | read | update")
  .action((action: string) => {
    console.log(`Note called with action: ${action}`);
  });

await program.parseAsync();
