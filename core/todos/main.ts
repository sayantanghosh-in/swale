import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { TodoSchema, type TodoRecord } from "../models.js";

export const createTodoObject = (
  text: string,
  createdBy: string,
  status: TodoRecord["status"],
): { success: boolean; todoObj: TodoRecord } => {
  const todoObj: TodoRecord = {
    id: randomUUID(),
    text,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy,
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
    "INSERT INTO todos (id, text, status, created_at, updated_at, created_by) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)",
  );
  const ranInsertStatement = preparedInsert.run(todo.id, todo.text, todo.status, todo.createdBy);
  return {
    success: ranInsertStatement?.changes === 1,
    todo,
  };
};

export const listTodos = (createdBy: string) => {
  /**
   * Hard limiting to 5 records for now.
   * @TODO - implement a pagination later.
   */
  return db
    .prepare(
      "SELECT todos.id, todos.text, todos.status, todos.created_at, todos.updated_at, users.email AS created_by_email, users.name AS created_by_name FROM todos inner join users on todos.created_by = users.id where todos.created_by = ? ORDER BY todos.updated_at DESC LIMIT 5",
    )
    .all(createdBy);
};

export const readTodo = (createdBy: string, id: string) => {
  return db
    .prepare(
      "SELECT todos.id, todos.text, todos.status, todos.created_at, todos.updated_at, users.email AS created_by_email, users.name AS created_by_name FROM todos inner join users on todos.created_by = users.id where todos.created_by = ? AND todos.id = ?",
    )
    .get(createdBy, id);
};

export const updateTodo = (createdBy: string, id: string, text: string) => {
  /**
   * if the todo item does not exist, return success: false,
   * else update the todo with the entered text
   */
  const matchingTodo = db
    .prepare("SELECT * FROM todos where created_by = ? AND id = ?")
    .get(createdBy, id);
  if (!matchingTodo?.id) {
    return {
      success: false,
      error: "TODO_NOT_FOUND",
    };
  }

  const preparedUpdate = db.prepare(
    "UPDATE todos SET text = ?, updated_at = CURRENT_TIMESTAMP where created_by = ? and id = ?",
  );
  const ranPreparedUpdate = preparedUpdate.run(text, createdBy, id);
  return {
    success: ranPreparedUpdate?.changes === 1,
    error: ranPreparedUpdate?.changes !== 1 ? "DB_ERROR" : null,
  };
};

export const deleteTodo = (createdBy: string, id: string) => {
  /**
   * if the todo item does not exist, return success: false,
   * else delete the todo
   */
  const matchingTodo = db
    .prepare("SELECT * FROM todos where created_by = ? AND id = ?")
    .get(createdBy, id);
  if (!matchingTodo?.id) {
    return {
      success: false,
      error: "TODO_NOT_FOUND",
    };
  }

  const preparedDelete = db.prepare("DELETE FROM todos where created_by = ? and id = ?");
  const ranPreparedDelete = preparedDelete.run(createdBy, id);
  return {
    success: ranPreparedDelete?.changes === 1,
    error: ranPreparedDelete?.changes !== 1 ? "DB_ERROR" : null,
  };
};
