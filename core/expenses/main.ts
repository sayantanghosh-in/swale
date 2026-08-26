import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { ExpenseSchema, type ExpenseRecord } from "../models.js";

export const createExpenseObject = (
  description: string,
  amount: number,
  createdBy: string,
): { success: boolean; expenseObj: ExpenseRecord } => {
  const expenseObj: ExpenseRecord = {
    id: randomUUID(),
    description,
    amount,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy,
  };
  const parseResult = ExpenseSchema.safeParse(expenseObj);

  return {
    success: parseResult.success,
    expenseObj,
  };
};

export const addExpense = (expense: ExpenseRecord) => {
  // add the expense to the 'expenses' table
  const preparedInsert = db.prepare(
    "INSERT INTO expenses (id, description, amount, created_at, updated_at, created_by) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)",
  );
  const ranInsertStatement = preparedInsert.run(
    expense.id,
    expense.description,
    expense.amount,
    expense.createdBy,
  );
  return {
    success: ranInsertStatement?.changes === 1,
    expense,
  };
};

export const listExpenses = (createdBy: string, description?: string) => {
  /**
   * Hard limiting to 5 records for now.
   * @TODO - implement a pagination later.
   */
  if (description?.length) {
    // return the expenses matching the description
    return db
      .prepare(
        "SELECT expenses.id, expenses.description, expenses.amount, expenses.created_at, expenses.updated_at, users.email AS created_by_email, users.name AS created_by_name FROM expenses inner join users on expenses.created_by = users.id where expenses.created_by = ? AND expenses.description LIKE (?) ORDER BY expenses.updated_at DESC LIMIT 5",
      )
      .all(createdBy, `%${description}%`);
  }
  return db
    .prepare(
      "SELECT expenses.id, expenses.description, expenses.amount, expenses.created_at, expenses.updated_at, users.email AS created_by_email, users.name AS created_by_name FROM expenses inner join users on expenses.created_by = users.id where expenses.created_by = ? ORDER BY expenses.updated_at DESC LIMIT 5",
    )
    .all(createdBy);
};

export const readExpense = (createdBy: string, id: string) => {
  return db
    .prepare(
      "SELECT expenses.id, expenses.description, expenses.amount, expenses.created_at, expenses.updated_at, users.email AS created_by_email, users.name AS created_by_name FROM expenses inner join users on expenses.created_by = users.id where expenses.created_by = ? AND expenses.id = ?",
    )
    .get(createdBy, id);
};

export const updateExpense = (
  createdBy: string,
  id: string,
  description: string | null,
  amount: number | null,
) => {
  /**
   * if the expense item does not exist, return success: false,
   * else update the expense with the entered text
   */
  const matchingExpense = db
    .prepare("SELECT * FROM expenses where created_by = ? AND id = ?")
    .get(createdBy, id);
  if (!matchingExpense?.id || !matchingExpense?.description || !matchingExpense?.amount) {
    return {
      success: false,
      error: "EXPENSE_NOT_FOUND",
    };
  }

  const preparedUpdate = db.prepare(
    "UPDATE expenses SET description = ?, amount = ?, updated_at = CURRENT_TIMESTAMP where created_by = ? and id = ?",
  );
  const ranPreparedUpdate = preparedUpdate.run(
    description === null ? matchingExpense?.description : description,
    amount === null ? matchingExpense?.amount : amount,
    createdBy,
    id,
  );
  return {
    success: ranPreparedUpdate?.changes === 1,
    error: ranPreparedUpdate?.changes !== 1 ? "DB_ERROR" : null,
  };
};

export const deleteExpense = (createdBy: string, id: string) => {
  /**
   * if the expense item does not exist, return success: false,
   * else delete the expense
   */
  const matchingExpense = db
    .prepare("SELECT * FROM expenses where created_by = ? AND id = ?")
    .get(createdBy, id);
  if (!matchingExpense?.id) {
    return {
      success: false,
      error: "EXPENSE_NOT_FOUND",
    };
  }

  const preparedDelete = db.prepare("DELETE FROM expenses where created_by = ? and id = ?");
  const ranPreparedDelete = preparedDelete.run(createdBy, id);
  return {
    success: ranPreparedDelete?.changes === 1,
    error: ranPreparedDelete?.changes !== 1 ? "DB_ERROR" : null,
  };
};
