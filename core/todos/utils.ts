import readline from "readline/promises";
import { TodoActionSchema, type TodoAction } from "../models.js";
import { addTodo, createTodoObject, listTodos } from "./main.js";

export const executeTodoAction = async (action: TodoAction, email: string, todoId: string = "") => {
  if (TodoActionSchema.safeParse(action).success === false) {
    console.error("ERROR_INVALID_TODO_ACTION");
  }
  switch (action) {
    case "add": {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const text: string = await rl.question("Enter todo: ");
      rl.close();
      const todoRecordResponse = createTodoObject(text, email, 0);
      if (todoRecordResponse.success) {
        const addTodoResponse = addTodo(todoRecordResponse.todoObj);
        if (addTodoResponse.success) {
          console.log("Todo added succesfully! To view the entire list use `swale todo list`");
        }
      } else {
        console.log("ERROR_INVALID_TODO_SHAPE");
      }
      break;
    }
    case "list": {
      const todos = listTodos(email);
      if (Array.isArray(todos)) {
        console.log("TODOs\n");
        todos.map((todo) => {
          console.table(todo);
        });
      } else {
        console.error("ERROR_TODOS_COULD_NOT_BE_FETCHED");
      }
      break;
    }

    default:
      break;
  }
};
