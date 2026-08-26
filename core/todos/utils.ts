import { formatDistanceToNow, isEqual } from "date-fns";
import readline from "readline/promises";
import { TodoActionSchema, type TodoAction } from "../models.js";
import { addTodo, createTodoObject, deleteTodo, listTodos, readTodo, updateTodo } from "./main.js";

export const executeTodoAction = async (action: TodoAction, createdBy: string, id: string = "") => {
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
      const todoRecordResponse = createTodoObject(text, createdBy, "todo");
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
      const todos = listTodos(createdBy);
      if (Array.isArray(todos)) {
        if (todos.length) {
          todos.map((todo) => {
            const utcDateString = (todo?.updated_at as string).replace(" ", "T") + "Z";
            const isCreatedButNotEdited = isEqual(
              todo?.created_at as string,
              todo?.updated_at as string,
            );
            console.log(
              `ID: ${todo?.id}\n${todo?.status} | ${
                isCreatedButNotEdited ? "Created" : "Edited"
              } by: ${todo?.created_by_name} <${todo?.created_by_email}> | ${isCreatedButNotEdited ? "Created" : "Last modified"}: ${formatDistanceToNow(new Date(utcDateString), { addSuffix: true })}\n> ${todo?.text}\n`,
            );
          });
        } else {
          console.log("No Todo to display... add one using `swale todo add`");
        }
      } else {
        console.error("ERROR_TODOS_COULD_NOT_BE_FETCHED");
      }
      break;
    }

    case "read": {
      const todo = readTodo(createdBy, id);
      if (todo?.id) {
        const utcDateString = (todo?.updated_at as string).replace(" ", "T") + "Z";
        const isCreatedButNotEdited = isEqual(
          todo?.created_at as string,
          todo?.updated_at as string,
        );
        console.log(
          `ID: ${todo?.id}\n${todo?.status} | ${
            isCreatedButNotEdited ? "Created" : "Edited"
          } by: ${todo?.created_by_name} <${todo?.created_by_email}> | ${isCreatedButNotEdited ? "Created" : "Last modified"}: ${formatDistanceToNow(new Date(utcDateString), { addSuffix: true })}\n> ${todo?.text}\n`,
        );
      } else {
        console.error(
          `No Todo item with the matching ID ${id}... list all of them using \`swale todo list\``,
        );
      }
      break;
    }

    case "update": {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const text: string = await rl.question("Enter updated todo: ");
      rl.close();
      const updateTodoResponse = updateTodo(createdBy, id, text);
      if (updateTodoResponse?.success) {
        console.log(
          `The Todo record with ID: ${id} has been updated successfully. View the updated record with \`swale todo read ${id}\``,
        );
      } else {
        if (updateTodoResponse.error === "TODO_NOT_FOUND") {
          console.error(
            `The todo item you intended to update does not exist... please try again with a valid todo uuid`,
          );
        } else if (updateTodoResponse.error === "DB_ERROR") {
          console.error(
            `Something weird happened while updating the todo... please try again in some time`,
          );
        }
      }
      break;
    }

    case "delete": {
      const deleteTodoResponse = deleteTodo(createdBy, id);
      if (deleteTodoResponse?.success) {
        console.log(
          `The Todo record with ID: ${id} has been deleted successfully. View all todos with \`swale todo list\``,
        );
      } else {
        if (deleteTodoResponse.error === "TODO_NOT_FOUND") {
          console.error(
            `The todo item you intended to delete does not exist... please try again with a valid todo uuid`,
          );
        } else if (deleteTodoResponse.error === "DB_ERROR") {
          console.error(
            `Something weird happened while deleting the todo... please try again in some time`,
          );
        }
      }
      break;
    }

    default:
      break;
  }
};
