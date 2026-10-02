import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
export const conversations = pgTable("conversation", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid().notNull(),
  projectId: uuid(),
  title: text().notNull(),
  access: text({ enum: ["inherited", "restricted"] }).notNull(),
});
export const participants = pgTable(
  "conversation_participant",
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id),
    userId: text(),
    agentId: uuid(),
    role: text({ enum: ["contributor", "viewer"] }).notNull(),
  },
  (t) => [
    check(
      "participant_exactly_one",
      sql`num_nonnulls(${t.userId},${t.agentId})=1`,
    ),
    uniqueIndex("participant_human_unique").on(t.conversationId, t.userId),
    uniqueIndex("participant_agent_unique").on(t.conversationId, t.agentId),
  ],
);
export const messages = pgTable(
  "message",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id),
    authorUserId: text(),
    authorAgentId: uuid(),
    body: text().notNull(),
    replyTo: uuid(),
    requestId: uuid().notNull(),
    revision: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "message_exactly_one_author",
      sql`num_nonnulls(${t.authorUserId},${t.authorAgentId})=1`,
    ),
    uniqueIndex("message_request_unique").on(t.conversationId, t.requestId),
    index("message_replay_idx").on(t.conversationId, t.revision),
  ],
);
