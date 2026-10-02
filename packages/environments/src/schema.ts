import * as agentsSchema from "@otto/agents/schema";
import * as workspacesSchema from "@otto/workspaces/schema";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
export const environments = pgTable(
  "environments",
  {
    id: uuid().primaryKey().defaultRandom(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
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
    executionScope: text(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "environments_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "environments_agentId_workspace_fk",
      columns: [t.agentId, t.workspaceId],
      foreignColumns: [agentsSchema.agents.id, agentsSchema.agents.workspaceId],
    }),
    unique("environments_identity_workspace").on(t.id, t.workspaceId),
    unique("environments_provider_computer_unique").on(
      t.provider,
      t.computerRef,
    ),
    check(
      "environments_state_values",
      sql`${t.state} IN ('unavailable','ready','uncertain')`,
    ),
  ],
);
