import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
export const tasks = pgTable(
  "task",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    title: text().notNull(),
    notes: text().notNull().default(""),
    ownerId: text().notNull(),
    assigneeUserId: text(),
    assigneeAgentId: uuid(),
    status: text({ enum: ["todo", "doing", "done"] })
      .notNull()
      .default("todo"),
    editToken: integer().notNull().default(0),
  },
  (t) => [
    check(
      "task_one_assignee",
      sql`${t.assigneeUserId} is null or ${t.assigneeAgentId} is null`,
    ),
    index("task_project_idx").on(t.projectId, t.id),
  ],
);
