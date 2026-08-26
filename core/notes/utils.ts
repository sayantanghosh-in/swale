import { formatDistanceToNow, isEqual } from "date-fns";
import readline from "readline/promises";
import { NoteActionSchema, type NoteAction } from "../models.js";
import { addNote, createNoteObject, deleteNote, listNotes, readNote, updateNote } from "./main.js";

export const executeNoteAction = async (action: NoteAction, createdBy: string, id: string = "") => {
  if (NoteActionSchema.safeParse(action).success === false) {
    console.error("ERROR_INVALID_NOTE_ACTION");
  }
  switch (action) {
    case "add": {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const text: string = await rl.question("Enter note: ");
      rl.close();
      const noteRecordResponse = createNoteObject(text, createdBy);
      if (noteRecordResponse.success) {
        const addNoteResponse = addNote(noteRecordResponse.noteObj);
        if (addNoteResponse.success) {
          console.log("Note added successfully! To view the entire list use `swale note list`");
        }
      } else {
        console.log("ERROR_INVALID_NOTE_SHAPE");
      }
      break;
    }

    case "list": {
      const notes = listNotes(createdBy);
      if (Array.isArray(notes)) {
        if (notes.length) {
          console.log("Notes\n");
          notes.map((note) => {
            const utcDateString = (note?.updated_at as string).replace(" ", "T") + "Z";
            const isCreatedButNotEdited = isEqual(
              note?.created_at as string,
              note?.updated_at as string,
            );
            console.log(
              `ID: ${note?.id}\n${
                isCreatedButNotEdited ? "Created" : "Edited"
              } by: ${note?.created_by_name} <${note?.created_by_email}> | ${isCreatedButNotEdited ? "Created" : "Last modified"}: ${formatDistanceToNow(new Date(utcDateString), { addSuffix: true })}\n> ${note?.text}\n`,
            );
          });
        } else {
          console.log("No Note to display... add one using `swale note add`");
        }
      } else {
        console.error("ERROR_NOTES_COULD_NOT_BE_FETCHED");
      }
      break;
    }

    case "read": {
      const note = readNote(createdBy, id);
      if (note?.id) {
        const utcDateString = (note?.updated_at as string).replace(" ", "T") + "Z";
        const isCreatedButNotEdited = isEqual(
          note?.created_at as string,
          note?.updated_at as string,
        );
        console.log(
          `ID: ${note?.id}\n${
            isCreatedButNotEdited ? "Created" : "Edited"
          } by: ${note?.created_by_name} <${note?.created_by_email}> | ${isCreatedButNotEdited ? "Created" : "Last modified"}: ${formatDistanceToNow(new Date(utcDateString), { addSuffix: true })}\n> ${note?.text}\n`,
        );
      } else {
        console.error(
          `No Note item with the matching ID ${id}... list all of them using \`swale note list\``,
        );
      }
      break;
    }

    case "update": {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const text: string = await rl.question("Enter updated note: ");
      rl.close();
      const updateNoteResponse = updateNote(createdBy, id, text);
      if (updateNoteResponse?.success) {
        console.log(
          `The note record with ID: ${id} has been updated successfully. View the updated record with \`swale note read ${id}\``,
        );
      } else {
        if (updateNoteResponse.error === "NOTE_NOT_FOUND") {
          console.error(
            `The note item you intended to update does not exist... please try again with a valid note uuid`,
          );
        } else if (updateNoteResponse.error === "DB_ERROR") {
          console.error(
            `Something weird happened while updating the note... please try again in some time`,
          );
        }
      }
      break;
    }

    case "delete": {
      const deleteNoteResponse = deleteNote(createdBy, id);
      if (deleteNoteResponse?.success) {
        console.log(
          `The note record with ID: ${id} has been deleted successfully. View all notes with \`swale note list\``,
        );
      } else {
        if (deleteNoteResponse.error === "NOTE_NOT_FOUND") {
          console.error(
            `The note item you intended to delete does not exist... please try again with a valid note uuid`,
          );
        } else if (deleteNoteResponse.error === "DB_ERROR") {
          console.error(
            `Something weird happened while deleting the note... please try again in some time`,
          );
        }
      }
      break;
    }

    default:
      break;
  }
};
