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
  jsonb,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
export const conversations = pgTable(
  "conversations",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    archived: boolean().notNull().default(false),
    projectId: uuid(),
    title: text().notNull(),
    editToken: integer().notNull().default(0),
    access: text({ enum: ["inherited", "restricted"] }).notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "conversations_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "conversations_projectId_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [
        projectsSchema.projects.id,
        projectsSchema.projects.workspaceId,
      ],
    }),
    unique("conversations_identity_workspace").on(t.id, t.workspaceId),
  ],
);
export const participants = pgTable(
  "conversation_participants",
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id),
    userId: text(),
    agentId: uuid(),
    role: text({ enum: ["contributor", "viewer"] }).notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "conversation_participants_userId_fk",
      columns: [t.userId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    foreignKey({
      name: "participant_agent_fk",
      columns: [t.agentId],
      foreignColumns: [agentsSchema.agents.id],
    }),
    check(
      "participant_exactly_one",
      sql`num_nonnulls(${t.userId},${t.agentId})=1`,
    ),
    uniqueIndex("participant_human_unique").on(t.conversationId, t.userId),
    uniqueIndex("participant_agent_unique").on(t.conversationId, t.agentId),
  ],
);
export const messages = pgTable(
  "messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id),
    authorUserId: text(),
    authorAgentId: uuid(),
    body: text().notNull(),
    mentionUserIds: jsonb().$type<string[]>().notNull().default([]),
    artifactIds: jsonb().$type<string[]>().notNull().default([]),
    replyTo: uuid(),
    requestId: uuid().notNull(),
    cursor: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "messages_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "messages_conversationId_workspace_fk",
      columns: [t.conversationId, t.workspaceId],
      foreignColumns: [conversations.id, conversations.workspaceId],
    }),
    foreignKey({
      name: "messages_authorAgentId_workspace_fk",
      columns: [t.authorAgentId, t.workspaceId],
      foreignColumns: [agentsSchema.agents.id, agentsSchema.agents.workspaceId],
    }),
    foreignKey({
      name: "messages_authorUserId_fk",
      columns: [t.authorUserId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("messages_identity_workspace").on(t.id, t.workspaceId),
    check("messages_size", sql`octet_length(${t.body})<=100000`),
    check(
      "messages_exactly_one_author",
      sql`num_nonnulls(${t.authorUserId},${t.authorAgentId})=1`,
    ),
    uniqueIndex("messages_request_unique").on(t.conversationId, t.requestId),
    index("messages_replay_idx").on(t.conversationId, t.cursor),
  ],
);

export const conversationReads = pgTable(
  "conversation_reads",
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id),
    userId: text().notNull(),
    cursor: integer().notNull().default(0),
  },
  (t): PgTableExtraConfigValue[] => [
    uniqueIndex("conversation_reads_identity").on(t.conversationId, t.userId),
  ],
);
