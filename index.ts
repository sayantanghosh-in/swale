import { program } from "commander";
import { parsePackageJsonContents } from "./core/utils.js";

const packageJsonContents = parsePackageJsonContents();

// Registering the program
program
  .name(packageJsonContents?.name)
  .description(packageJsonContents?.description)
  .version(packageJsonContents?.version);

// Registering all the commands
program
  .command("todo")
  .argument("<action>", "add | delete | list | read | update")
  .action((action: string) => {
    console.log(`Todo called with action: ${action}`);
  });

program
  .command("expense")
  .argument("<action>", "add | delete | list | read | update")
  .action((action: string) => {
    console.log(`Expense called with action: ${action}`);
  });

program
  .command("note <action>")
  .argument("<action>", "add | delete | list | read | update")
  .action((action: string) => {
    console.log(`Note called with action: ${action}`);
  });

program.parse();
