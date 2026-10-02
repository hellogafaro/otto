import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
export interface RunRequest {
  conversationId: string;
  agentId: string;
  requestId: string;
  kind: "prompt" | "script";
  body: string;
  taskId?: string;
  sessionId?: string;
  skillIds?: string[];
  automationId?: string;
  automationToken?: number;
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
  harnessRelease: string;
  model: string;
  accountConnectionId: string | null;
  agentConfigToken: number;
  audience: { humans: string[]; agents: string[] };
  skills: {
    documentId: string;
    title: string;
    instructions: string;
    whenToUse: string | null;
    editToken: number;
  }[];
  grants: {
    id: string;
    connectionId: string;
    configToken: number;
    resources: string[];
    operations: Record<string, "allowed" | "confirmation" | "disabled">;
    sponsorId: string;
  }[];
}
export const runs = pgTable(
  "run",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    conversationId: uuid().notNull(),
    agentId: uuid().notNull(),
    sponsorId: text().notNull(),
    taskId: uuid(),
    automationId: uuid(),
    automationToken: integer(),
    sessionId: uuid(),
    environmentId: uuid().notNull(),
    environmentGeneration: integer().notNull(),
    requestId: text().notNull(),
    // Legacy attempts lack recoverable caller controls; their retries fail closed.
    requestIdentity: jsonb().$type<RunRequestIdentity>(),
    kind: text({ enum: ["prompt", "script"] }).notNull(),
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
    outcome: text(),
    revision: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("run_request_unique").on(
      t.workspaceId,
      t.sponsorId,
      t.requestId,
    ),
    uniqueIndex("run_automation_active")
      .on(t.automationId)
      .where(sql`${t.state} in ('queued','launching','running','uncertain')`),
    check(
      "run_prompt_session",
      sql`(${t.kind}='prompt' and ${t.sessionId} is not null) or (${t.kind}='script' and ${t.sessionId} is null)`,
    ),
    index("run_conversation_replay").on(t.conversationId, t.revision),
  ],
);
