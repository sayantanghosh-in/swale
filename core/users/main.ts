import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { UserSchema, type SupportedCurrencies, type UserRecord } from "../models.js";

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
  };
  const parseResult = UserSchema.safeParse(userObj);

  return {
    success: parseResult.success,
    userObj,
  };
};

/**
 * @TODO - will be updated later on with an authentication system
 *  */
export const getFirstUser = (): UserRecord | undefined => {
  return db.prepare("SELECT * FROM users LIMIT 1").get() as UserRecord | undefined;
};

export const insertUser = (userObj: UserRecord): { success: boolean } => {
  // insert the user to the 'users' table
  const preparedInsert = db.prepare(
    "INSERT INTO users (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const ranInsertStatement = preparedInsert.run(
    userObj.id,
    userObj.name,
    userObj.email,
    userObj.createdAt.toString(),
    userObj.updatedAt.toString(),
  );
  return {
    success: ranInsertStatement?.changes === 1,
  };
};
