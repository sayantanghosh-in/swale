import { z } from "zod";

export type PackageJsonContents = {
  name: string;
  version: string;
  description: string;
};

export type SupportedCurrencies = "INR" | "USD" | "EUR" | "GBP" | "Other";

export type SupportedExpenseUpdateOptions = "Amount" | "Description" | "Both";

export const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  phone: z.string(),
  currency: z.literal(["INR", "USD", "EUR", "GBP", "Other"]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserRecord = z.infer<typeof UserSchema>;

export const TodoSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  status: z.literal(["todo", "in_progress", "done"]),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string(),
});

export const TodoActionSchema = z.literal(["add", "delete", "read", "list", "update"]);

export type TodoRecord = z.infer<typeof TodoSchema>;
export type TodoAction = z.infer<typeof TodoActionSchema>;

export const NoteSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string(),
});

export const NoteActionSchema = z.literal(["add", "delete", "read", "list", "update"]);

export type NoteRecord = z.infer<typeof NoteSchema>;
export type NoteAction = z.infer<typeof NoteActionSchema>;

export const ExpenseSchema = z.object({
  id: z.uuid(),
  description: z.string(),
  amount: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string(),
});

export const ExpenseActionSchema = z.literal(["add", "delete", "read", "list", "update"]);

export type ExpenseRecord = z.infer<typeof ExpenseSchema>;
export type ExpenseAction = z.infer<typeof ExpenseActionSchema>;
