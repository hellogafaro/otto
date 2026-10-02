import * as agentsSchema from "@otto/agents/schema";
import * as projectsSchema from "@otto/projects/schema";
import * as workspacesSchema from "@otto/workspaces/schema";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
export const tasks = pgTable(
  "tasks",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    archived: boolean().notNull().default(false),
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
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "tasks_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "tasks_projectId_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [
        projectsSchema.projects.id,
        projectsSchema.projects.workspaceId,
      ],
    }),
    foreignKey({
      name: "tasks_assigneeAgentId_workspace_fk",
      columns: [t.assigneeAgentId, t.workspaceId],
      foreignColumns: [agentsSchema.agents.id, agentsSchema.agents.workspaceId],
    }),
    foreignKey({
      name: "tasks_ownerId_fk",
      columns: [t.ownerId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    foreignKey({
      name: "tasks_assigneeUserId_fk",
      columns: [t.assigneeUserId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("tasks_identity_workspace").on(t.id, t.workspaceId),
    check("tasks_status_values", sql`${t.status} IN ('todo','doing','done')`),
    check(
      "tasks_one_assignee",
      sql`${t.assigneeUserId} is null or ${t.assigneeAgentId} is null`,
    ),
    index("tasks_project_idx").on(t.projectId, t.id),
  ],
);

export const taskLinks = pgTable(
  "task_links",
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id),
    type: text({
      enum: ["document", "conversation", "artifact", "url"],
    }).notNull(),
    reference: text().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    uniqueIndex("task_links_identity").on(t.taskId, t.type, t.reference),
  ],
);
