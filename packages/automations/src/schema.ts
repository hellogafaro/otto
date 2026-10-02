import * as agentsSchema from "@otto/agents/schema";
import * as conversationsSchema from "@otto/conversations/schema";
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
export const automations = pgTable(
  "automations",
  {
    id: uuid().primaryKey().defaultRandom(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
    workspaceId: uuid().notNull(),
    ownerId: text().notNull(),
    agentId: uuid().notNull(),
    conversationId: uuid().notNull(),
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
      "automations_status",
      sql`${t.status} in ('enabled','disabled','archived')`,
    ),
    foreignKey({
      name: "automations_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "automations_agentId_workspace_fk",
      columns: [t.agentId, t.workspaceId],
      foreignColumns: [agentsSchema.agents.id, agentsSchema.agents.workspaceId],
    }),
    foreignKey({
      name: "automations_conversationId_workspace_fk",
      columns: [t.conversationId, t.workspaceId],
      foreignColumns: [
        conversationsSchema.conversations.id,
        conversationsSchema.conversations.workspaceId,
      ],
    }),
    foreignKey({
      name: "automations_ownerId_fk",
      columns: [t.ownerId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("automations_identity_workspace").on(t.id, t.workspaceId),
    index("automations_workspace").on(t.workspaceId, t.id),
  ],
);
export const automationHistory = pgTable("automation_history", {
  id: uuid().primaryKey(),
  automationId: uuid()
    .notNull()
    .references(() => automations.id),
  runId: uuid(),
  outcome: text().notNull(),
  receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
