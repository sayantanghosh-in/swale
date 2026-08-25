import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { UserSchema, type UserRecord } from "../models.js";

export const createUserObject = (
  name: string,
  email: string,
  phone: string,
): { success: boolean; userObj: UserRecord } => {
  const userObj: UserRecord = {
    id: randomUUID(),
    name,
    email,
    phone,
    createdAt: new Date(),
    updatedAt: new Date(),
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
    "INSERT INTO users (id, name, email, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const ranInsertStatement = preparedInsert.run(
    userObj.id,
    userObj.name,
    userObj.email,
    userObj.phone,
    userObj.createdAt.toString(),
    userObj.updatedAt.toString(),
  );
  return {
    success: ranInsertStatement?.changes === 1,
  };
};
