import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
export const environments = pgTable("environment", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid().notNull(),
  agentId: uuid().notNull().unique(),
  scope: text().notNull(),
  generation: integer().notNull().default(0),
  state: text({ enum: ["unavailable", "ready", "uncertain"] })
    .notNull()
    .default("unavailable"),
  provider: text(),
  computerRef: text(),
  activeRunId: uuid(),
});
