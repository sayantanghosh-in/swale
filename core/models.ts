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

export const TodoSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  email: z.email(),
  status: z.literal(["todo", "in_progress", "done"]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const TodoActionSchema = z.literal(["add", "delete", "read", "list", "update"]);

export type TodoRecord = z.infer<typeof TodoSchema>;
export type TodoAction = z.infer<typeof TodoActionSchema>;
