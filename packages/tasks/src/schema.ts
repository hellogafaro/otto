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
  primaryKey,
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
    dueAt: timestamp({ withTimezone: true }),
    /** RFC 5545 DTSTART+RRULE text; the successor of a completed Task copies it unchanged. */
    recurrence: text(),
    /** Server-only one-successor fence: the Task this occurrence was created from on completion. */
    predecessorId: uuid(),
    ownerId: text().notNull(),
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
      name: "tasks_ownerId_fk",
      columns: [t.ownerId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    foreignKey({
      name: "tasks_predecessorId_workspace_fk",
      columns: [t.predecessorId, t.workspaceId],
      foreignColumns: [t.id, t.workspaceId],
    }),
    unique("tasks_identity_workspace").on(t.id, t.workspaceId),
    uniqueIndex("tasks_predecessor_unique").on(t.predecessorId),
    check("tasks_recurrence_bytes", sql`octet_length(${t.recurrence}) <= 400`),
    check("tasks_status_values", sql`${t.status} IN ('todo','doing','done')`),
    index("tasks_project_idx").on(t.projectId, t.id),
  ],
);

/** Pure junctions: zero or many human and Agent assignees; ownerId stays the one human owner. */
export const taskUsers = pgTable(
  "tasks_users",
  {
    workspaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    userId: text().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    foreignKey({
      name: "tasks_users_task_workspace_fk",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }),
    foreignKey({
      name: "tasks_users_user_fk",
      columns: [t.userId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    index("tasks_users_user_idx").on(t.userId, t.taskId),
  ],
);

export const taskAgents = pgTable(
  "tasks_agents",
  {
    workspaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    agentId: uuid().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.taskId, t.agentId] }),
    foreignKey({
      name: "tasks_agents_task_workspace_fk",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }),
    foreignKey({
      name: "tasks_agents_agent_workspace_fk",
      columns: [t.agentId, t.workspaceId],
      foreignColumns: [agentsSchema.agents.id, agentsSchema.agents.workspaceId],
    }),
    index("tasks_agents_agent_idx").on(t.agentId, t.taskId),
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
      enum: ["document", "chat", "file", "url"],
    }).notNull(),
    reference: text().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    uniqueIndex("task_links_identity").on(t.taskId, t.type, t.reference),
  ],
);

/** Manual human time in whole minutes; createdAt is the logging event. */
export const timesheets = pgTable(
  "timesheets",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    duration: integer().notNull(),
    notes: text(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "timesheets_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "timesheets_task_workspace_fk",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }),
    foreignKey({
      name: "timesheets_createdBy_fk",
      columns: [t.createdBy],
      foreignColumns: [workspacesSchema.users.id],
    }),
    check("timesheets_duration_positive", sql`${t.duration} > 0`),
    check("timesheets_notes_bytes", sql`octet_length(${t.notes}) <= 4000`),
    index("timesheets_task_idx").on(t.taskId, t.id),
  ],
);
