// node imports
import { randomUUID } from "node:crypto";
// local imports
import { db } from "../db.js";
import { UserSchema, type UserRecord } from "../models.js";
import { removeConfigKey } from "../utils.js";

export const createUserObject = (
  name: string,
  email: string,
): { success: boolean; userObj: UserRecord } => {
  const currentDate = new Date();
  const userObj: UserRecord = {
    id: randomUUID(),
    name,
    email,
    createdAt: currentDate,
    updatedAt: currentDate,
    active: true,
  };
  const parseResult = UserSchema.safeParse(userObj);

  return {
    success: parseResult.success,
    userObj,
  };
};

export const getActiveUser = (): UserRecord | undefined => {
  return db.prepare("SELECT * FROM users where active = 'true'").get() as UserRecord | undefined;
};

export const deactivateAllUsers = () => {
  // drop only the github credentials, leaving any other config (llm, ...) intact
  removeConfigKey("github");
  // make `active` column of all users false
  const preparedUpdate = db.prepare("UPDATE users SET active = 'false'");
  preparedUpdate.run();
  return {
    success: true,
    error: null,
  };
};

export const loginUser = (userId: string) => {
  // make `active` column of all users false
  const preparedUpdate = db.prepare("UPDATE users SET active = 'true' where id = ?");
  const preparedUpdateRan = preparedUpdate.run(userId);
  return {
    success: preparedUpdateRan?.changes === 1 ? true : false,
    error: preparedUpdateRan?.changes === 1 ? null : "ERROR_LOGIN_DATABASE",
  };
};

export const insertUser = (userObj: UserRecord): { success: boolean } => {
  const preparedInsert = db.prepare(`
    INSERT INTO users (id, name, email, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name       = excluded.name,
      email      = excluded.email,
      active     = excluded.active,
      updated_at = excluded.updated_at
  `);
  const ranInsertStatement = preparedInsert.run(
    userObj.id,
    userObj.name,
    userObj.email ?? null,
    String(userObj.active ?? false).toLowerCase(),
    userObj.createdAt.toISOString(),
    userObj.updatedAt.toISOString(),
  );
  return {
    success: ranInsertStatement?.changes === 1,
  };
};

export const listAllUsers = () => {
  return db.prepare("SELECT id, name, email FROM users").all();
};
