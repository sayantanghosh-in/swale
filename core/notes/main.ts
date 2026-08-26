import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { NoteSchema, type NoteRecord } from "../models.js";

export const createNoteObject = (
  text: string,
  createdBy: string,
): { success: boolean; noteObj: NoteRecord } => {
  const noteObj: NoteRecord = {
    id: randomUUID(),
    text,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy,
  };
  const parseResult = NoteSchema.safeParse(noteObj);

  return {
    success: parseResult.success,
    noteObj,
  };
};

export const addNote = (note: NoteRecord) => {
  // add the note to the 'notes' table
  const preparedInsert = db.prepare(
    "INSERT INTO notes (id, text, created_at, updated_at, created_by) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)",
  );
  const ranInsertStatement = preparedInsert.run(note.id, note.text, note.createdBy);
  return {
    success: ranInsertStatement?.changes === 1,
    note,
  };
};

export const listNotes = (createdBy: string) => {
  /**
   * Hard limiting to 5 records for now.
   * @TODO - implement a pagination later.
   */
  return db
    .prepare(
      "SELECT notes.id, notes.text, notes.created_at, notes.updated_at, users.email AS created_by_email, users.name AS created_by_name FROM notes inner join users on notes.created_by = users.id where notes.created_by = ? ORDER BY notes.updated_at DESC LIMIT 5",
    )
    .all(createdBy);
};

export const readNote = (createdBy: string, id: string) => {
  return db
    .prepare(
      "SELECT notes.id, notes.text, notes.created_at, notes.updated_at, users.email AS created_by_email, users.name AS created_by_name FROM notes inner join users on notes.created_by = users.id where notes.created_by = ? AND notes.id = ?",
    )
    .get(createdBy, id);
};

export const updateNote = (createdBy: string, id: string, text: string) => {
  /**
   * if the note item does not exist, return success: false,
   * else update the note with the entered text
   */
  const matchingNote = db
    .prepare("SELECT * FROM notes where created_by = ? AND id = ?")
    .get(createdBy, id);
  if (!matchingNote?.id) {
    return {
      success: false,
      error: "NOTE_NOT_FOUND",
    };
  }

  const preparedUpdate = db.prepare(
    "UPDATE notes SET text = ?, updated_at = CURRENT_TIMESTAMP where created_by = ? and id = ?",
  );
  const ranPreparedUpdate = preparedUpdate.run(text, createdBy, id);
  return {
    success: ranPreparedUpdate?.changes === 1,
    error: ranPreparedUpdate?.changes !== 1 ? "DB_ERROR" : null,
  };
};

export const deleteNote = (createdBy: string, id: string) => {
  /**
   * if the note item does not exist, return success: false,
   * else delete the note
   */
  const matchingNote = db
    .prepare("SELECT * FROM notes where created_by = ? AND id = ?")
    .get(createdBy, id);
  if (!matchingNote?.id) {
    return {
      success: false,
      error: "NOTE_NOT_FOUND",
    };
  }

  const preparedDelete = db.prepare("DELETE FROM notes where created_by = ? and id = ?");
  const ranPreparedDelete = preparedDelete.run(createdBy, id);
  return {
    success: ranPreparedDelete?.changes === 1,
    error: ranPreparedDelete?.changes !== 1 ? "DB_ERROR" : null,
  };
};
