import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { TodoSchema, type TodoRecord } from "../models.js";

export const createTodoObject = (
  text: string,
  email: string,
  done: number,
): { success: boolean; todoObj: TodoRecord } => {
  const todoObj: TodoRecord = {
    id: randomUUID(),
    text,
    email,
    done,
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
    "INSERT INTO todos (id, text, email, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const ranInsertStatement = preparedInsert.run(
    todo.id,
    todo.text,
    todo.email,
    todo.done,
    todo.createdAt.toString(),
    todo.updatedAt.toString(),
  );
  return {
    success: ranInsertStatement?.changes === 1,
    todo,
  };
};

export const listTodos = (email: string) => {
  return db.prepare("SELECT * from todos where email = ?").all(email);
};
