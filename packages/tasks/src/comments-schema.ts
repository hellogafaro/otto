import * as agentsSchema from "@otto/agents/schema";
import * as workspacesSchema from "@otto/workspaces/schema";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tasks } from "./schema";

export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    createdBy: text().notNull(),
    agentId: uuid(),
    body: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "task_comments_task_workspace_fk",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }),
    foreignKey({
      name: "task_comments_createdBy_fk",
      columns: [t.createdBy],
      foreignColumns: [workspacesSchema.users.id],
    }),
    foreignKey({
      name: "task_comments_agent_workspace_fk",
      columns: [t.agentId, t.workspaceId],
      foreignColumns: [agentsSchema.agents.id, agentsSchema.agents.workspaceId],
    }),
    check(
      "task_comments_body_bytes",
      sql`octet_length(${t.body}) between 1 and 10000 and length(btrim(${t.body})) > 0`,
    ),
    index("task_comments_task_created_idx").on(t.taskId, t.createdAt, t.id),
  ],
);
