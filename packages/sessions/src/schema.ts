import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
export const sessions = pgTable("agent_session", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid().notNull(),
  conversationId: uuid().notNull(),
  agentId: uuid().notNull(),
  environmentId: uuid().notNull(),
  environmentGeneration: integer().notNull(),
  scope: text().notNull(),
  harness: text().notNull(),
  harnessRelease: text().notNull(),
  accountConnectionId: uuid(),
  contextRef: text(),
});
