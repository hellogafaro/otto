import * as agentsSchema from "@otto/agents/schema";
import * as automationsSchema from "@otto/automations/schema";
import * as conversationsSchema from "@otto/conversations/schema";
import type { SkillFileReference } from "@otto/documents";
import * as environmentsSchema from "@otto/environments/schema";
import * as sessionsSchema from "@otto/sessions/schema";
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
  conversationId: string;
  agentId: string;
  requestId: string;
  type: "prompt" | "script";
  body: string;
  taskId?: string;
  sessionId?: string;
  documentIds?: string[];
  messageIds?: string[];
  automationId?: string;
  automationEditToken?: number;
}
/** Caller controls only. Resolved Agent defaults and source contents belong in RunInputs. */
export type RunRequestIdentity = {
  [Key in keyof Required<RunRequest>]:
    | Exclude<RunRequest[Key], undefined>
    | (undefined extends RunRequest[Key] ? null : never);
};
export interface RunInputs {
  body: string;
  instructions: string;
  harness: string;
  harnessVersion: string | null;
  model: string;
  subscriptionId: string | null;
  agentEditToken: number;
  audience: { humans: string[]; agents: string[] };
  skills: {
    documentId: string;
    title: string;
    instructions: string;
    whenToUse: string | null;
    editToken: number;
    supportingFiles?: SkillFileReference[];
  }[];
  context?: {
    task: { id: string; title: string; notes: string | null } | null;
    documents: {
      id: string;
      title: string;
      body: string;
      editToken?: number;
    }[];
    messages: { id: string; body: string }[];
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
    conversationId: uuid().notNull(),
    agentId: uuid().notNull(),
    sponsorId: text().notNull(),
    taskId: uuid(),
    automationId: uuid(),
    automationEditToken: integer(),
    sessionId: uuid(),
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
    parentRunId: uuid(),
    handoffDepth: integer().notNull().default(0),
    outcome: text(),
    cursor: integer().notNull(),
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
      name: "runs_conversationId_workspace_fk",
      columns: [t.conversationId, t.workspaceId],
      foreignColumns: [
        conversationsSchema.conversations.id,
        conversationsSchema.conversations.workspaceId,
      ],
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
      name: "runs_automationId_workspace_fk",
      columns: [t.automationId, t.workspaceId],
      foreignColumns: [
        automationsSchema.automations.id,
        automationsSchema.automations.workspaceId,
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
    check("runs_input_size", sql`octet_length(${t.inputs}::text)<=1048576`),
    index("runs_environment_queue").on(t.environmentId, t.state),
    uniqueIndex("runs_request_unique").on(
      t.workspaceId,
      t.sponsorId,
      t.requestId,
    ),
    uniqueIndex("runs_automation_active")
      .on(t.automationId)
      .where(sql`${t.state} in ('queued','launching','running','uncertain')`),
    check(
      "runs_prompt_session",
      sql`(${t.type}='prompt' and ${t.sessionId} is not null) or (${t.type}='script' and ${t.sessionId} is null)`,
    ),
    index("runs_conversation_replay").on(t.conversationId, t.cursor),
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
