import * as agentsSchema from "@otto/agents/schema";
import * as chatsSchema from "@otto/chats/schema";
import * as environmentsSchema from "@otto/environments/schema";
import * as schedulesSchema from "@otto/schedules/schema";
import * as sessionsSchema from "@otto/sessions/schema";
import type { AcceptedSkillFileReference } from "@otto/skills";
import * as tasksSchema from "@otto/tasks/schema";
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
export interface RunRequest {
  chatId: string;
  agentId: string;
  requestId: string;
  type: "prompt" | "script";
  body: string;
  taskId?: string;
  sessionId?: string;
  sessionMode?: "auto" | "fresh";
  documentIds?: string[];
  messageIds?: string[];
  scheduleId?: string;
  scheduleEditToken?: number;
}
/** Caller controls only. Resolved Agent defaults and source contents belong in RunInputs. */
type RequestControls = Omit<RunRequest, "scheduleId" | "scheduleEditToken">;
/** Private accepted keys are retained; public Run controls use Schedule and Chat vocabulary only. */
export type RunRequestIdentity = {
  [Key in keyof Required<Omit<RequestControls, "chatId">>]:
    | Exclude<RequestControls[Key], undefined>
    | (undefined extends RequestControls[Key] ? null : never);
} & {
  conversationId: string;
  automationId: string | null;
  automationEditToken: number | null;
};
/** Catalog API list price in USD per million tokens. A price basis for estimates, never an account charge. */
export interface ModelCostRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
export interface ModelConfig {
  id: string;
  provider: "openai" | "anthropic" | "openai-compatible";
  protocol: "responses" | "chat-completions" | "anthropic";
  baseUrl: string;
  /** Accepted with the Run so later catalog changes never reprice it; absent means the price is unknown. */
  cost?: ModelCostRates & {
    tiers?: (ModelCostRates & { inputTokensAbove: number })[];
  };
}
export interface RunInputs {
  body: string;
  instructions: string;
  provider: string | null;
  model: string;
  subscriptionId: string | null;
  accountId: string | null;
  modelConfig: ModelConfig | null;
  agentEditToken: number;
  taskReviewEditToken?: number;
  sessionMode?: "auto" | "fresh";
  sessionScope?: string;
  triggeringMessageId?: string;
  chatCursor?: number;
  publicMessages?: {
    id: string;
    body: string;
    authorUserId: string | null;
    authorAgentId: string | null;
    cursor: number;
  }[];
  audience: { humans: string[]; agents: string[] };
  skills: {
    documentId: string;
    title: string;
    instructions: string;
    whenToUse: string | null;
    editToken: number;
    supportingFiles?: AcceptedSkillFileReference[];
  }[];
  context?: {
    task: { id: string; title: string; notes: string | null } | null;
    documents: {
      id: string;
      title: string;
      body: string;
      editToken?: number;
    }[];
    messages: { id: string; body: string; fileIds: string[] }[];
  };
  grants: {
    id: string;
    connectionId: string;
    editToken: number;
    resources: string[];
    operations: Record<string, "allowed" | "confirmation" | "disabled">;
    sponsorId: string;
    audience?: { humans: string[]; agents: string[] };
  }[];
}
export const runs = pgTable(
  "runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    chatId: uuid().notNull(),
    agentId: uuid().notNull(),
    sponsorId: text().notNull(),
    taskId: uuid(),
    scheduleId: uuid(),
    scheduleEditToken: integer(),
    sessionId: uuid(),
    sessionState: text({ enum: ["new", "continued", "reset"] }),
    environmentId: uuid().notNull(),
    environmentGeneration: integer().notNull(),
    requestId: text().notNull(),
    // Legacy attempts lack recoverable caller controls; their retries fail closed.
    requestIdentity: jsonb().$type<RunRequestIdentity>(),
    type: text({ enum: ["prompt", "script"] }).notNull(),
    inputs: jsonb().$type<RunInputs>().notNull(),
    state: text({
      enum: [
        "queued",
        "launching",
        "running",
        "finished",
        "failed",
        "interrupted",
        "uncertain",
      ],
    })
      .notNull()
      .default("queued"),
    launchKey: uuid().notNull().defaultRandom(),
    attempt: integer().notNull().default(0),
    executionRef: text(),
    deadlineAt: timestamp({ withTimezone: true }),
    stopRequested: boolean().notNull().default(false),
    outputBytes: integer().notNull().default(0),
    usage: jsonb().$type<UsageReceipt[]>().notNull().default([]),
    parentRunId: uuid(),
    handoffDepth: integer().notNull().default(0),
    outcome: text(),
    cursor: integer().notNull(),
    admittedCursor: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "runs_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "runs_chatId_workspace_fk",
      columns: [t.chatId, t.workspaceId],
      foreignColumns: [chatsSchema.chats.id, chatsSchema.chats.workspaceId],
    }),
    foreignKey({
      name: "runs_agentId_workspace_fk",
      columns: [t.agentId, t.workspaceId],
      foreignColumns: [agentsSchema.agents.id, agentsSchema.agents.workspaceId],
    }),
    foreignKey({
      name: "runs_taskId_workspace_fk",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [tasksSchema.tasks.id, tasksSchema.tasks.workspaceId],
    }),
    foreignKey({
      name: "runs_scheduleId_workspace_fk",
      columns: [t.scheduleId, t.workspaceId],
      foreignColumns: [
        schedulesSchema.schedules.id,
        schedulesSchema.schedules.workspaceId,
      ],
    }),
    foreignKey({
      name: "runs_sessionId_workspace_fk",
      columns: [t.sessionId, t.workspaceId],
      foreignColumns: [
        sessionsSchema.sessions.id,
        sessionsSchema.sessions.workspaceId,
      ],
    }),
    foreignKey({
      name: "runs_environmentId_workspace_fk",
      columns: [t.environmentId, t.workspaceId],
      foreignColumns: [
        environmentsSchema.environments.id,
        environmentsSchema.environments.workspaceId,
      ],
    }),
    foreignKey({
      name: "runs_sponsorId_fk",
      columns: [t.sponsorId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("runs_identity_workspace").on(t.id, t.workspaceId),
    check(
      "runs_state_values",
      sql`${t.state} IN ('queued','launching','running','finished','failed','interrupted','uncertain')`,
    ),
    check("runs_usage_bound", sql`jsonb_array_length(${t.usage})<=256`),
    check("runs_input_size", sql`octet_length(${t.inputs}::text)<=1048576`),
    index("runs_environment_queue").on(t.environmentId, t.state),
    uniqueIndex("runs_agent_execution")
      .on(t.agentId)
      .where(sql`${t.state} in ('launching','running','uncertain')`),
    uniqueIndex("runs_session_execution")
      .on(t.sessionId)
      .where(sql`${t.state} in ('launching','running','uncertain')`),
    uniqueIndex("runs_request_unique").on(
      t.workspaceId,
      t.sponsorId,
      t.requestId,
    ),
    uniqueIndex("runs_schedule_active")
      .on(t.scheduleId)
      .where(sql`${t.state} in ('queued','launching','running','uncertain')`),
    check(
      "runs_prompt_session",
      sql`(${t.type}='prompt' and (${t.sessionId} is not null or (coalesce(${t.inputs}->>'sessionMode','')='auto' and ${t.attempt}=0 and ${t.state} in ('queued','failed','interrupted')))) or (${t.type}='script' and ${t.sessionId} is null)`,
    ),
    index("runs_chat_replay").on(t.chatId, t.cursor),
  ],
);

export const runActivity = pgTable(
  "run_activities",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    runId: uuid()
      .notNull()
      .references(() => runs.id),
    requestId: text().notNull(),
    type: text({
      enum: ["output", "steer", "question"],
    }).notNull(),
    body: text().notNull(),
    answer: text(),
    answeredBy: text(),
    answeredAt: timestamp({ withTimezone: true }),
    cursor: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    uniqueIndex("run_activities_request").on(t.runId, t.requestId),
    index("run_activities_cursor").on(t.runId, t.cursor),
  ],
);

export const runEffects = pgTable(
  "run_effects",
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid()
      .notNull()
      .references(() => runs.id),
    toolCallId: text().notNull(),
    toolName: text().notNull(),
    inputHash: text().notNull(),
    attempt: integer().notNull(),
    result: jsonb().$type<unknown>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    uniqueIndex("run_effects_call").on(t.runId, t.toolCallId),
    check(
      "run_effects_result_bound",
      sql`octet_length(${t.result}::text)<=65536`,
    ),
  ],
);

/** Final assistant-message usage only; null means the upstream did not report it. */
export interface UsageTokens {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
}
export interface UsageReceipt {
  attempt: number;
  sequence: number;
  tokens: UsageTokens;
}
