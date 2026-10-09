import { CONNECTION_AUDIENCE } from "@otto/connections";
import { CONNECTION_CONFIG } from "@otto/connections/server";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { runs } from "./schema";

const id = z.uuid();
const humanId = z.string().min(1).max(128);
const title = z.string().trim().min(1).max(200);
const body = z
  .string()
  .max(100000)
  .refine((value) => Buffer.byteLength(value) <= 100000);
const editToken = z.number().int().nonnegative();
const visibility = z.enum(["user", "workspace"]);
const labels = z.array(title).max(30);
const fields = z
  .array(
    z
      .object({
        id,
        title,
        type: z.enum([
          "text",
          "number",
          "date",
          "checkbox",
          "select",
          "human",
          "agent",
          "document",
        ]),
        options: z.array(title).max(100).optional(),
      })
      .strict(),
  )
  .max(50);
const schedule = z
  .object({
    title,
    agentId: id,
    chatId: id,
    runType: z.literal("prompt"),
    body,
    taskId: id.optional(),
    cron: z.string().max(200).optional(),
    timezone: z.string().min(1).max(100),
    status: z.enum(["enabled", "disabled", "archived"]),
  })
  .strict();

export const nativeActionInput = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("document.proposal.resolve"),
      id,
      proposalId: id,
      editToken,
      accept: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("skill.proposal.resolve"),
      id,
      proposalId: id,
      editToken,
      accept: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("schedule.run"), id, editToken }).strict(),
  z
    .object({
      type: z.literal("project.create"),
      title,
      repositoryUrl: z.url().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("project.update"),
      id,
      title: title.optional(),
      repositoryUrl: z.url().max(2000).nullable().optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("project.archive"), id, archived: z.boolean() })
    .strict(),
  z
    .object({
      type: z.literal("project.member.upsert"),
      id,
      userId: humanId,
      role: z.enum(["viewer", "contributor"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("project.member.update"),
      id,
      userId: humanId,
      role: z.enum(["viewer", "contributor"]),
    })
    .strict(),
  z
    .object({ type: z.literal("project.member.delete"), id, userId: humanId })
    .strict(),
  z
    .object({
      type: z.literal("document.create"),
      title,
      body,
      labels: labels.optional(),
      projectId: id.optional(),
      visibility,
      folderId: id.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("document.update"),
      id,
      editToken,
      title: title.optional(),
      body: body.optional(),
      labels: labels.optional(),
      visibility: visibility.optional(),
      folderId: id.nullable().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("document.archive"),
      id,
      editToken,
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("document.collection"),
      id,
      editToken,
      collectionId: id,
      properties: z
        .record(
          z.string().min(1).max(100),
          z.union([
            z.string().max(10000),
            z.number().finite(),
            z.boolean(),
            z.null(),
          ]),
        )
        .refine((value) => Object.keys(value).length <= 50),
    })
    .strict(),
  z
    .object({
      type: z.literal("document.attachments"),
      id,
      editToken,
      fileIds: z.array(id).max(50),
    })
    .strict(),
  z
    .object({
      type: z.literal("collection.create"),
      title,
      projectId: id.optional(),
      fields,
    })
    .strict(),
  z
    .object({
      type: z.literal("collection.update"),
      id,
      editToken,
      title: title.optional(),
      fields: fields.optional(),
      view: z.enum(["table", "list"]).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("collection.archive"),
      id,
      editToken,
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("folder.create"),
      title,
      projectId: id.optional(),
      parentId: id.optional(),
      visibility,
    })
    .strict(),
  z
    .object({
      type: z.literal("folder.update"),
      id,
      title: title.optional(),
      parentId: id.nullable().optional(),
      visibility: visibility.optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("folder.archive"), id, archived: z.boolean() })
    .strict(),
  z
    .object({
      type: z.literal("task.status"),
      id,
      editToken,
      status: z.literal("done"),
    })
    .strict(),
  z
    .object({
      type: z.literal("task.update"),
      id,
      editToken,
      title: z.string().min(1).max(200).optional(),
      notes: z.string().max(16000).optional(),
      dueAt: z.iso.datetime().nullable().optional(),
      recurrence: z.string().max(200).nullable().optional(),
      ownerId: humanId.optional(),
      assigneeUserIds: z.array(humanId).max(20).optional(),
      assigneeAgentIds: z.array(id).max(20).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("task.archive"),
      id,
      editToken,
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("timesheet.create"),
      taskId: id,
      duration: z.number().int().positive().max(2147483647),
      notes: z.string().max(10000).nullable().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("timesheet.update"),
      id,
      duration: z.number().int().positive().max(2147483647).optional(),
      notes: z.string().max(10000).nullable().optional(),
    })
    .strict(),
  z.object({ type: z.literal("timesheet.delete"), id }).strict(),
  z
    .object({
      type: z.literal("file.update"),
      id,
      title: title.optional(),
      labels: labels.optional(),
      visibility: visibility.optional(),
      folderId: id.nullable().optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("file.archive"), id, archived: z.boolean() })
    .strict(),
  z
    .object({
      type: z.literal("agent.create"),
      title,
      instructions: body,
      model: z.string().min(1).max(200),
      projectId: id.optional(),
      subscriptionId: id.optional(),
      skillIds: z.array(id).max(50).optional(),
      visibility,
    })
    .strict(),
  z
    .object({
      type: z.literal("agent.update"),
      id,
      editToken,
      title: title.optional(),
      instructions: body.optional(),
      model: z.string().min(1).max(200).optional(),
      subscriptionId: id.nullable().optional(),
      skillIds: z.array(id).max(50).optional(),
      visibility: visibility.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent.archive"),
      id,
      editToken,
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("skill.create"),
      title,
      instructions: body,
      projectId: id.optional(),
      visibility,
      whenToUse: z.string().max(10000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("skill.update"),
      id,
      editToken,
      title: title.optional(),
      instructions: body.optional(),
      visibility: visibility.optional(),
      whenToUse: z.string().max(10000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("skill.archive"),
      id,
      editToken,
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("chat.create"),
      title,
      projectId: id.optional(),
      visibility: z.enum(["workspace", "participants"]),
    })
    .strict(),
  z.object({ type: z.literal("chat.update"), id, title }).strict(),
  z
    .object({ type: z.literal("chat.archive"), id, archived: z.boolean() })
    .strict(),
  z
    .object({
      type: z.literal("chat.participant.create"),
      id,
      userId: humanId.optional(),
      agentId: id.optional(),
      role: z.enum(["viewer", "contributor"]),
    })
    .strict()
    .refine((value) => Boolean(value.userId) !== Boolean(value.agentId)),
  z
    .object({
      type: z.literal("chat.participant.update"),
      id,
      participantId: id,
      role: z.enum(["viewer", "contributor"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("chat.participant.delete"),
      id,
      participantId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("connection.create"),
      title,
      connectionType: z.enum(["github", "mcp"]),
      accountRef: z.string().min(1).max(200),
      visibility,
    })
    .strict(),
  z
    .object({
      type: z.literal("connection.update"),
      id,
      editToken,
      title: title.optional(),
      visibility: visibility.optional(),
      config: CONNECTION_CONFIG.optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("connection.disconnect"), id, editToken })
    .strict(),
  z
    .object({
      type: z.literal("connection.grant"),
      id,
      editToken,
      agentId: id,
      audience: CONNECTION_AUDIENCE,
      resources: z.array(z.string().min(1).max(2000)).max(100),
      operations: z
        .record(
          z.string().min(1).max(200),
          z.enum(["allowed", "confirmation", "disabled"]),
        )
        .refine((value) => Object.keys(value).length <= 50),
    })
    .strict(),
  z
    .object({
      type: z.literal("connection.revoke"),
      id,
      editToken,
      agentId: id,
    })
    .strict(),
  schedule.extend({ type: z.literal("schedule.create") }).strict(),
  z
    .object({
      type: z.literal("skill.import"),
      skillMd: body,
      projectId: id.optional(),
      visibility,
    })
    .strict(),
  z
    .object({
      type: z.literal("skill.files"),
      id,
      editToken,
      files: z
        .array(
          z
            .object({
              path: z
                .string()
                .max(240)
                .regex(/^(scripts|references|assets)\/[a-zA-Z0-9._/-]+$/),
              fileId: id,
            })
            .strict(),
        )
        .max(30),
    })
    .strict(),
  schedule
    .partial()
    .extend({
      type: z.literal("schedule.update"),
      id,
      editToken,
      ownerId: humanId.optional(),
    })
    .strict(),
]);
export type NativeActionInput = z.infer<typeof nativeActionInput>;
export interface NativeActionResult {
  id?: string;
  editToken?: number;
  removed?: boolean;
  ok?: boolean;
}

export const runActions = pgTable(
  "run_actions",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    runId: uuid().notNull(),
    toolCallId: text().notNull(),
    attempt: integer().notNull(),
    launchKey: uuid().notNull(),
    sponsorId: text().notNull(),
    agentId: uuid().notNull(),
    input: jsonb().$type<NativeActionInput>().notNull(),
    digest: text().notNull(),
    status: text({ enum: ["pending", "approved", "denied"] })
      .notNull()
      .default("pending"),
    resolvedBy: text(),
    result: jsonb().$type<NativeActionResult>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      "run_actions_status",
      sql`${t.status} in ('pending','approved','denied')`,
    ),
    check(
      "run_actions_resolution",
      sql`(${t.status} = 'pending' and ${t.resolvedBy} is null and ${t.resolvedAt} is null and ${t.result} is null) or (${t.status} = 'approved' and ${t.resolvedBy} = ${t.sponsorId} and ${t.resolvedAt} is not null and ${t.result} is not null) or (${t.status} = 'denied' and ${t.resolvedBy} = ${t.sponsorId} and ${t.resolvedAt} is not null and ${t.result} is null)`,
    ),
    check(
      "run_actions_input_bound",
      sql`octet_length(${t.input}::text) <= 131072`,
    ),
    unique("run_actions_run_tool_unique").on(t.runId, t.toolCallId),
    index("run_actions_pending_index").on(t.workspaceId, t.runId, t.status),
    foreignKey({
      name: "run_actions_run_workspace_fk",
      columns: [t.runId, t.workspaceId],
      foreignColumns: [runs.id, runs.workspaceId],
    }),
  ],
);
