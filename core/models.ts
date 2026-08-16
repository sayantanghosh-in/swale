import { z } from "zod";

export type PackageJsonContents = {
  name: string;
  version: string;
  description: string;
};

export const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  phone: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserRecord = z.infer<typeof UserSchema>;

export type TodoRecord = {};
