import * as agentsSchema from "@otto/agents/schema";
import * as chatsSchema from "@otto/chats/schema";
import * as workspacesSchema from "@otto/workspaces/schema";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
export const schedules = pgTable(
  "schedules",
  {
    id: uuid().primaryKey().defaultRandom(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
    workspaceId: uuid().notNull(),
    ownerId: text().notNull(),
    agentId: uuid().notNull(),
    chatId: uuid().notNull(),
    title: text("name").notNull(),
    type: text({ enum: ["prompt", "script"] }).notNull(),
    body: text().notNull(),
    taskId: uuid(),
    cron: text(),
    timezone: text().notNull().default("UTC"),
    status: text({ enum: ["enabled", "disabled", "archived"] })
      .notNull()
      .default("disabled"),
    editToken: integer().notNull().default(0),
  },
  (t): PgTableExtraConfigValue[] => [
    check(
      "schedules_status",
      sql`${t.status} in ('enabled','disabled','archived')`,
    ),
    foreignKey({
      name: "schedules_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "schedules_agentId_workspace_fk",
      columns: [t.agentId, t.workspaceId],
      foreignColumns: [agentsSchema.agents.id, agentsSchema.agents.workspaceId],
    }),
    foreignKey({
      name: "schedules_chatId_workspace_fk",
      columns: [t.chatId, t.workspaceId],
      foreignColumns: [chatsSchema.chats.id, chatsSchema.chats.workspaceId],
    }),
    foreignKey({
      name: "schedules_ownerId_fk",
      columns: [t.ownerId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("schedules_identity_workspace").on(t.id, t.workspaceId),
    index("schedules_workspace").on(t.workspaceId, t.id),
  ],
);
export const scheduleHistory = pgTable("schedule_history", {
  id: uuid().primaryKey(),
  scheduleId: uuid()
    .notNull()
    .references(() => schedules.id),
  runId: uuid(),
  outcome: text().notNull(),
  receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
