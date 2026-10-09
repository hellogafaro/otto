import * as agentsSchema from "@otto/agents/schema";
import * as chatsSchema from "@otto/chats/schema";
import * as environmentsSchema from "@otto/environments/schema";
import * as subscriptionsSchema from "@otto/subscriptions/schema";
import * as workspacesSchema from "@otto/workspaces/schema";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
export type SessionSource =
  | { type: "document" | "file" | "task"; id: string }
  | { type: "attachment"; chatId: string; messageId: string; fileId: string }
  | {
      type: "skill-file";
      skillId: string;
      path: string;
      fileId: string;
      sha256: string;
      byteLength: number;
    };

export const sessions = pgTable(
  "agent_sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
    workspaceId: uuid().notNull(),
    chatId: uuid().notNull(),
    agentId: uuid().notNull(),
    ownerId: text().notNull(),
    mode: text({ enum: ["manual", "auto"] })
      .notNull()
      .default("manual"),
    createdCursor: integer().notNull().default(0),
    sources: jsonb().$type<SessionSource[]>().notNull().default([]),
    sourcesCertified: boolean().notNull().default(false),
    environmentId: uuid().notNull(),
    environmentGeneration: integer().notNull(),
    scope: text().notNull(),
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
      name: "agent_sessions_chatId_workspace_fk",
      columns: [t.chatId, t.workspaceId],
      foreignColumns: [chatsSchema.chats.id, chatsSchema.chats.workspaceId],
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
    index("agent_sessions_auto_owner").on(
      t.workspaceId,
      t.chatId,
      t.agentId,
      t.ownerId,
      t.mode,
      t.createdCursor,
    ),
  ],
);
