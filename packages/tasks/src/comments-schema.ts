import * as agentsSchema from "@otto/agents/schema";
import * as chatsSchema from "@otto/chats/schema";
import * as workspacesSchema from "@otto/workspaces/schema";
import { sql } from "drizzle-orm";
import {
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
import { tasks } from "./schema";

export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    createdBy: text().notNull(),
    agentId: uuid(),
    body: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "task_comments_task_workspace_fk",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }),
    foreignKey({
      name: "task_comments_createdBy_fk",
      columns: [t.createdBy],
      foreignColumns: [workspacesSchema.users.id],
    }),
    foreignKey({
      name: "task_comments_agent_workspace_fk",
      columns: [t.agentId, t.workspaceId],
      foreignColumns: [agentsSchema.agents.id, agentsSchema.agents.workspaceId],
    }),
    check(
      "task_comments_body_bytes",
      sql`octet_length(${t.body}) between 1 and 10000 and length(btrim(${t.body})) > 0`,
    ),
    index("task_comments_task_created_idx").on(t.taskId, t.createdAt, t.id),
    unique("task_comments_identity_task_workspace").on(
      t.id,
      t.taskId,
      t.workspaceId,
    ),
  ],
);

export const taskReviews = pgTable(
  "tasks_reviews",
  {
    workspaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    commentId: uuid().notNull(),
    chatId: uuid(),
    agentId: uuid(),
    editToken: integer().notNull(),
    decisionRequestId: uuid(),
    decisionCommentId: uuid(),
    decisionBy: text(),
    decisionHash: text(),
    decisionInput: jsonb().$type<{
      requestId: string;
      editToken: number;
      decision: "approve" | "request_changes";
      body?: string;
    }>(),
    continuationStatus: text({ enum: ["pending", "sent", "unavailable"] }),
    decisionResult: jsonb().$type<{
      task: typeof tasks.$inferSelect & {
        assigneeUserIds: string[];
        assigneeAgentIds: string[];
        successorId: string | null;
      };
      comment: typeof taskComments.$inferSelect;
      chatId: string | null;
      agentId: string | null;
    }>(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.commentId] }),
    uniqueIndex("tasks_reviews_task_edit_token").on(t.taskId, t.editToken),
    uniqueIndex("tasks_reviews_task_request").on(t.taskId, t.decisionRequestId),
    foreignKey({
      name: "tasks_reviews_task_workspace_fk",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }),
    foreignKey({
      name: "tasks_reviews_comment_fk",
      columns: [t.commentId, t.taskId, t.workspaceId],
      foreignColumns: [
        taskComments.id,
        taskComments.taskId,
        taskComments.workspaceId,
      ],
    }),
    foreignKey({
      name: "tasks_reviews_decision_comment_fk",
      columns: [t.decisionCommentId, t.taskId, t.workspaceId],
      foreignColumns: [
        taskComments.id,
        taskComments.taskId,
        taskComments.workspaceId,
      ],
    }),
    foreignKey({
      name: "tasks_reviews_chat_workspace_fk",
      columns: [t.chatId, t.workspaceId],
      foreignColumns: [chatsSchema.chats.id, chatsSchema.chats.workspaceId],
    }),
    foreignKey({
      name: "tasks_reviews_agent_workspace_fk",
      columns: [t.agentId, t.workspaceId],
      foreignColumns: [agentsSchema.agents.id, agentsSchema.agents.workspaceId],
    }),
  ],
);
