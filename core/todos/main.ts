import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { TodoSchema, type TodoRecord } from "../models.js";

export const createTodoObject = (
  text: string,
  email: string,
  status: TodoRecord["status"],
): { success: boolean; todoObj: TodoRecord } => {
  const todoObj: TodoRecord = {
    id: randomUUID(),
    text,
    email,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const parseResult = TodoSchema.safeParse(todoObj);

  return {
    success: parseResult.success,
    todoObj,
  };
};

export const addTodo = (todo: TodoRecord) => {
  // add the user to the 'users' table
  const preparedInsert = db.prepare(
    "INSERT INTO todos (id, text, email, status, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
  );
  const ranInsertStatement = preparedInsert.run(todo.id, todo.text, todo.email, todo.status);
  return {
    success: ranInsertStatement?.changes === 1,
    todo,
  };
};

export const listTodos = (email: string) => {
  /**
   * Hard limiting to 5 records for now.
   * @TODO - implement a pagination later.
   */
  return db.prepare("SELECT * FROM todos where email = ? LIMIT 5").all(email);
};

export const readTodo = (email: string, id: string) => {
  return db.prepare("SELECT * FROM todos where email = ? AND id = ?").get(email, id);
};

export const updateTodo = (email: string, id: string, text: string) => {
  /**
   * if the todo item does not exist, return success: false,
   * else update the todo with the entered text
   */
  const matchingTodo = db.prepare("SELECT * FROM todos where email = ? AND id = ?").get(email, id);
  if (!matchingTodo?.id) {
    return {
      success: false,
      error: "TODO_NOT_FOUND",
    };
  }

  const preparedUpdate = db.prepare(
    "UPDATE todos SET text = ?, updated_at = CURRENT_TIMESTAMP where email = ? and id = ?",
  );
  const ranPreparedUpdate = preparedUpdate.run(text, email, id);
  return {
    success: ranPreparedUpdate?.changes === 1,
    error: ranPreparedUpdate?.changes !== 1 ? "DB_ERROR" : null,
  };
};

export const deleteTodo = (email: string, id: string) => {
  /**
   * if the todo item does not exist, return success: false,
   * else delete the todo
   */
  const matchingTodo = db.prepare("SELECT * FROM todos where email = ? AND id = ?").get(email, id);
  if (!matchingTodo?.id) {
    return {
      success: false,
      error: "TODO_NOT_FOUND",
    };
  }

  const preparedDelete = db.prepare("DELETE FROM todos where email = ? and id = ?");
  const ranPreparedDelete = preparedDelete.run(email, id);
  return {
    success: ranPreparedDelete?.changes === 1,
    error: ranPreparedDelete?.changes !== 1 ? "DB_ERROR" : null,
  };
};
