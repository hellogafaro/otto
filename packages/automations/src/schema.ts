import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
export const automations = pgTable("automation", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid().notNull(),
  ownerId: text().notNull(),
  agentId: uuid().notNull(),
  conversationId: uuid().notNull(),
  projectId: uuid(),
  name: text().notNull(),
  kind: text({ enum: ["prompt", "script"] }).notNull(),
  body: text().notNull(),
  skillIds: jsonb().$type<string[]>().notNull().default([]),
  cron: text(),
  timezone: text().notNull().default("UTC"),
  enabled: boolean().notNull().default(false),
  configToken: integer().notNull().default(0),
});
export const occurrences = pgTable("automation_occurrence", {
  jobId: uuid().primaryKey(),
  automationId: uuid()
    .notNull()
    .references(() => automations.id),
  runId: uuid(),
  outcome: text().notNull(),
  receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
