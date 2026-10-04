import * as agentsSchema from "@otto/agents/schema";
import * as conversationsSchema from "@otto/conversations/schema";
import * as environmentsSchema from "@otto/environments/schema";
import * as subscriptionsSchema from "@otto/subscriptions/schema";
import * as workspacesSchema from "@otto/workspaces/schema";
import {
  foreignKey,
  integer,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
export const sessions = pgTable(
  "agent_sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
    workspaceId: uuid().notNull(),
    conversationId: uuid().notNull(),
    agentId: uuid().notNull(),
    environmentId: uuid().notNull(),
    environmentGeneration: integer().notNull(),
    scope: text().notNull(),
    piVersion: text().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    accountId: text().notNull(),
    subscriptionId: uuid(),
    contextRef: text(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "agent_sessions_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "agent_sessions_conversationId_workspace_fk",
      columns: [t.conversationId, t.workspaceId],
      foreignColumns: [
        conversationsSchema.conversations.id,
        conversationsSchema.conversations.workspaceId,
      ],
    }),
    foreignKey({
      name: "agent_sessions_agentId_workspace_fk",
      columns: [t.agentId, t.workspaceId],
      foreignColumns: [agentsSchema.agents.id, agentsSchema.agents.workspaceId],
    }),
    foreignKey({
      name: "agent_sessions_environmentId_workspace_fk",
      columns: [t.environmentId, t.workspaceId],
      foreignColumns: [
        environmentsSchema.environments.id,
        environmentsSchema.environments.workspaceId,
      ],
    }),
    foreignKey({
      name: "agent_sessions_subscriptionId_workspace_fk",
      columns: [t.subscriptionId, t.workspaceId],
      foreignColumns: [
        subscriptionsSchema.subscriptions.id,
        subscriptionsSchema.subscriptions.workspaceId,
      ],
    }),
    unique("agent_sessions_identity_workspace").on(t.id, t.workspaceId),
  ],
);
