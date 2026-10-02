import { integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
export const agents = pgTable("agent", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid().notNull(),
  projectId: uuid(),
  ownerId: text().notNull(),
  name: text().notNull(),
  instructions: text().notNull(),
  harness: text().notNull(),
  harnessRelease: text().notNull(),
  model: text().notNull(),
  accountConnectionId: uuid(),
  skillIds: jsonb().$type<string[]>().notNull().default([]),
  configToken: integer().notNull().default(0),
});
