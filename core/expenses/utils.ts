import { formatDistanceToNow, isEqual } from "date-fns";
import readline from "readline/promises";
import {
  ExpenseActionSchema,
  type ExpenseAction,
  type SupportedCurrencies,
  type SupportedExpenseUpdateOptions,
} from "../models.js";
import {
  addExpense,
  createExpenseObject,
  deleteExpense,
  listExpenses,
  readExpense,
  updateExpense,
} from "./main.js";
import { select } from "@inquirer/prompts";

export const executeExpenseAction = async (
  action: ExpenseAction,
  createdBy: string,
  defaultCurrency: SupportedCurrencies,
  id: string = "",
) => {
  if (ExpenseActionSchema.safeParse(action).success === false) {
    console.error("ERROR_INVALID_EXPENSE_ACTION");
  }
  switch (action) {
    case "add": {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const description: string = await rl.question("What did you spend on? ");
      const amount: number = Number(
        await rl.question(`How much did you spend (default currency: ${defaultCurrency})? `),
      );
      rl.close();
      const expenseRecordResponse = createExpenseObject(description, amount, createdBy);
      if (expenseRecordResponse.success) {
        const addExpenseResponse = addExpense(expenseRecordResponse.expenseObj);
        if (addExpenseResponse.success) {
          console.log(
            "Expense added succesfully! To view the entire list use `swale expense list`",
          );
        }
      } else {
        console.log("ERROR_INVALID_EXPENSE_SHAPE");
      }
      break;
    }

    case "list": {
      const expenses = listExpenses(createdBy);
      if (Array.isArray(expenses)) {
        if (expenses.length) {
          expenses.map((expense) => {
            const utcDateString = (expense?.updated_at as string).replace(" ", "T") + "Z";
            const isCreatedButNotEdited = isEqual(
              expense?.created_at as string,
              expense?.updated_at as string,
            );
            const formattedAmount =
              defaultCurrency === "Other"
                ? `(Other) ${expense?.amount || 0}`
                : new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: defaultCurrency,
                  }).format((expense?.amount as number) || 0);
            console.log(
              `ID: ${expense?.id}\n${formattedAmount} | ${
                isCreatedButNotEdited ? "Created" : "Edited"
              } by: ${expense?.created_by_name} <${expense?.created_by_email}> | ${isCreatedButNotEdited ? "Created" : "Last modified"}: ${formatDistanceToNow(new Date(utcDateString), { addSuffix: true })}\n> ${expense?.description}\n`,
            );
          });
        } else {
          console.log("No Expense to display... add one using `swale expense add`");
        }
      } else {
        console.error("ERROR_EXPENSES_COULD_NOT_BE_FETCHED");
      }
      break;
    }

    case "read": {
      const expense = readExpense(createdBy, id);
      if (expense?.id) {
        const utcDateString = (expense?.updated_at as string).replace(" ", "T") + "Z";
        const isCreatedButNotEdited = isEqual(
          expense?.created_at as string,
          expense?.updated_at as string,
        );
        const formattedAmount =
          defaultCurrency === "Other"
            ? `(Other) ${expense?.amount || 0}`
            : new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: defaultCurrency,
              }).format((expense?.amount as number) || 0);
        console.log(
          `ID: ${expense?.id}\n${formattedAmount} | ${
            isCreatedButNotEdited ? "Created" : "Edited"
          } by: ${expense?.created_by_name} <${expense?.created_by_email}> | ${isCreatedButNotEdited ? "Created" : "Last modified"}: ${formatDistanceToNow(new Date(utcDateString), { addSuffix: true })}\n> ${expense?.description}\n`,
        );
      } else {
        console.error(
          `No Expense item with the matching ID ${id}... list all of them using \`swale expense list\``,
        );
      }
      break;
    }

    case "update": {
      const selectedExpenseUpdateOption = (await select({
        message: "What do you want to update?",
        choices: ["Amount", "Description", "Both"].map((option) => {
          return {
            name: option,
            value: option,
          };
        }),
      })) as SupportedExpenseUpdateOptions;
      let description = null;
      let amount = null;
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      if (selectedExpenseUpdateOption === "Amount") {
        amount = parseInt(await rl.question("Enter updated amount: "));
      } else if (selectedExpenseUpdateOption === "Description") {
        description = await rl.question("Enter updated expense: ");
      } else {
        amount = parseInt(await rl.question("Enter updated amount: "));
        description = await rl.question("Enter updated expense: ");
      }
      rl.close();
      const updateExpenseResponse = updateExpense(createdBy, id, description, amount);
      if (updateExpenseResponse?.success) {
        console.log(
          `The Expense record with ID: ${id} has been updated successfully. View the updated record with \`swale expense read ${id}\``,
        );
      } else {
        if (updateExpenseResponse.error === "EXPENSE_NOT_FOUND") {
          console.error(
            `The expense item you intended to update does not exist... please try again with a valid expense uuid`,
          );
        } else if (updateExpenseResponse.error === "DB_ERROR") {
          console.error(
            `Something weird happened while updating the expense... please try again in some time`,
          );
        }
      }
      break;
    }

    case "delete": {
      const deleteExpenseResponse = deleteExpense(createdBy, id);
      if (deleteExpenseResponse?.success) {
        console.log(
          `The Expense record with ID: ${id} has been deleted successfully. View all expenses with \`swale expense list\``,
        );
      } else {
        if (deleteExpenseResponse.error === "EXPENSE_NOT_FOUND") {
          console.error(
            `The expense item you intended to delete does not exist... please try again with a valid expense uuid`,
          );
        } else if (deleteExpenseResponse.error === "DB_ERROR") {
          console.error(
            `Something weird happened while deleting the expense... please try again in some time`,
          );
        }
      }
      break;
    }

    default:
      break;
  }
};
