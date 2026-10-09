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
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
export const chats = pgTable(
  "chats",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    archived: boolean().notNull().default(false),
    projectId: uuid(),
    title: text().notNull(),
    visibility: text({ enum: ["workspace", "participants"] }).notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    check(
      "chats_visibility",
      sql`${t.visibility} in ('workspace','participants')`,
    ),
    foreignKey({
      name: "chats_createdBy_fk",
      columns: [t.createdBy],
      foreignColumns: [workspacesSchema.users.id],
    }),
    foreignKey({
      name: "chats_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "chats_projectId_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [
        projectsSchema.projects.id,
        projectsSchema.projects.workspaceId,
      ],
    }),
    unique("chats_identity_workspace").on(t.id, t.workspaceId),
  ],
);
export const participants = pgTable(
  "chat_participants",
  {
    id: uuid().primaryKey().defaultRandom(),
    chatId: uuid()
      .notNull()
      .references(() => chats.id),
    userId: text(),
    agentId: uuid(),
    role: text({ enum: ["contributor", "viewer"] }).notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "chat_participants_userId_fk",
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
    uniqueIndex("participant_human_unique").on(t.chatId, t.userId),
    uniqueIndex("participant_agent_unique").on(t.chatId, t.agentId),
  ],
);
export const messages = pgTable(
  "messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    chatId: uuid().notNull(),
    authorUserId: text(),
    authorAgentId: uuid(),
    body: text().notNull(),
    mentionUserIds: jsonb().$type<string[]>().notNull().default([]),
    fileIds: jsonb().$type<string[]>().notNull().default([]),
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
      name: "messages_chatId_workspace_fk",
      columns: [t.chatId, t.workspaceId],
      foreignColumns: [chats.id, chats.workspaceId],
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
    check("messages_size", sql`octet_length(${t.body})<=100000`),
    check(
      "messages_exactly_one_author",
      sql`num_nonnulls(${t.authorUserId},${t.authorAgentId})=1`,
    ),
    uniqueIndex("messages_request_unique").on(t.chatId, t.requestId),
    index("messages_replay_idx").on(t.chatId, t.cursor),
    index("messages_files_idx").using("gin", t.fileIds),
  ],
);

export const chatReads = pgTable(
  "chat_reads",
  {
    chatId: uuid()
      .notNull()
      .references(() => chats.id),
    userId: text().notNull(),
    cursor: integer().notNull().default(0),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.chatId, t.userId] }),
  ],
);
