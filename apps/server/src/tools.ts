import { createHash } from "node:crypto";
import type { ToolsInput } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import {
  createMessage,
  getChat,
  getChatAudience,
  getMessage,
  getMessages,
  getParticipants,
  PARTICIPANT_SORTS,
} from "@otto/chats";
import { getConnection } from "@otto/connections";
import type { CursorCodec, Database } from "@otto/db";
import {
  COLLECTION_SORTS,
  DOCUMENT_SORTS,
  getCollection,
  getCollections,
  getDocument,
  getDocumentAudience,
  getDocuments,
  proposeDocumentChange,
} from "@otto/documents";
import {
  createFile,
  FILE_SORTS,
  type FileStorage,
  getFile,
  getFiles,
  readFile,
  requireFileAudience,
} from "@otto/files";
import {
  getProject,
  getProjectAudience,
  getProjectMembers,
  PROJECT_MEMBER_SORTS,
} from "@otto/projects";
import {
  authorizePeerRun,
  createRunQuestion,
  getRun,
  getRunActivity,
  getRunQuestion,
  getRuns,
  getRunUsage,
  type ModelAuthorization,
  prepareRunModel,
  RUN_SORTS,
  requestPeerRun,
} from "@otto/runs";
import { nativeActionInput } from "@otto/runs/actions";
import {
  type Attempt,
  assertRunAttempt,
  withRunAttempt,
  withRunEffect,
} from "@otto/runs/runtime";
import {
  getSchedule,
  getScheduleHistory,
  SCHEDULE_HISTORY_SORTS,
  validateSchedule,
} from "@otto/schedules";
import {
  invalidateSessionSources,
  recordSessionSources,
  type SessionSource,
} from "@otto/sessions";
import type { NativeSessionStorage } from "@otto/sessions/native";
import { DomainError, required } from "@otto/shared";
import {
  exportSkill,
  getSkill,
  getSkillAudience,
  getSkills,
  proposeSkillChange,
  SKILL_SORTS,
} from "@otto/skills";
import {
  createTask,
  createTaskLink,
  deleteTaskLink,
  getTask,
  getTaskLinks,
  getTasks,
  getTimesheet,
  getTimesheets,
  setTaskStatus,
  TASK_LINK_SORTS,
  TASK_SORTS,
  TIMESHEET_SORTS,
  updateTask,
} from "@otto/tasks";
import {
  createTaskComment,
  deleteTaskComment,
  getTaskComment,
  getTaskComments,
  updateTaskComment,
} from "@otto/tasks/comments";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { type ConnectionOptions, connectionService } from "./connections";
import { requestNativeAction } from "./native-actions";
import { authorizeRunSources } from "./run-sources";
import { readRunSkillFile } from "./skill-files";
import { captureTask } from "./task-capture";

const pageInput = {
  after: z.string().max(4000).optional(),
  limit: z.number().int().min(1).max(100).default(100),
  order: z.enum(["asc", "desc"]).optional(),
};
const taskSelection = { taskId: z.uuid() };
const taskFields = {
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(16000).optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  recurrence: z.string().max(200).nullable().optional(),
  assigneeUserIds: z.array(z.string().min(1).max(128)).max(100).optional(),
  assigneeAgentIds: z.array(z.uuid()).max(100).optional(),
};

export const toolInput = z.discriminatedUnion("name", [
  z.object({ name: z.literal("chat.get") }).strict(),
  z
    .object({
      name: z.literal("chat.participants"),
      ...pageInput,
      sort: z.enum(PARTICIPANT_SORTS).optional(),
    })
    .strict(),
  z.object({ name: z.literal("message.get"), messageId: z.uuid() }).strict(),
  z.object({ name: z.literal("run.get") }).strict(),
  z
    .object({
      name: z.literal("run.list"),
      ...pageInput,
      sort: z.enum(RUN_SORTS).optional(),
    })
    .strict(),
  z
    .object({
      name: z.literal("run.activity"),
      after: z.number().int().nonnegative().default(0),
    })
    .strict(),
  z.object({ name: z.literal("run.usage") }).strict(),
  z
    .object({ name: z.literal("connection.get"), connectionId: z.uuid() })
    .strict(),
  z.object({ name: z.literal("connection.list") }).strict(),
  z.object({ name: z.literal("schedule.get"), scheduleId: z.uuid() }).strict(),
  z
    .object({
      name: z.literal("schedule.history"),
      scheduleId: z.uuid(),
      ...pageInput,
      sort: z.enum(SCHEDULE_HISTORY_SORTS).optional(),
    })
    .strict(),
  z.object({ name: z.literal("project.get") }).strict(),
  z
    .object({
      name: z.literal("project.members"),
      ...pageInput,
      sort: z.enum(PROJECT_MEMBER_SORTS).optional(),
    })
    .strict(),
  z
    .object({
      name: z.literal("task.list"),
      ...pageInput,
      sort: z.enum(TASK_SORTS).optional(),
      query: z.string().max(200).optional(),
      archived: z.boolean().optional(),
      status: z.enum(["todo", "doing", "done"]).optional(),
      ownerId: z.string().max(128).optional(),
      assigneeUserId: z.string().max(128).optional(),
      assigneeAgentId: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      name: z.literal("task.update"),
      ...taskSelection,
      ...taskFields,
      editToken: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      name: z.literal("task.status"),
      ...taskSelection,
      status: z.enum(["todo", "doing"]),
      editToken: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      name: z.literal("task.links"),
      ...taskSelection,
      ...pageInput,
      sort: z.enum(TASK_LINK_SORTS).optional(),
    })
    .strict(),
  z
    .object({
      name: z.literal("task.link.create"),
      ...taskSelection,
      type: z.enum(["document", "chat", "file", "url"]),
      reference: z.string().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      name: z.literal("task.link.delete"),
      ...taskSelection,
      linkId: z.uuid(),
    })
    .strict(),
  z
    .object({
      name: z.literal("task.comment.create"),
      ...taskSelection,
      body: z.string().min(1).max(16000),
    })
    .strict(),
  z
    .object({ name: z.literal("task.comment.get"), commentId: z.uuid() })
    .strict(),
  z
    .object({
      name: z.literal("task.comment.list"),
      ...taskSelection,
      ...pageInput,
      sort: z.enum(["createdAt", "updatedAt"]).optional(),
    })
    .strict(),
  z
    .object({
      name: z.literal("task.comment.update"),
      commentId: z.uuid(),
      body: z.string().min(1).max(16000),
    })
    .strict(),
  z
    .object({ name: z.literal("task.comment.delete"), commentId: z.uuid() })
    .strict(),
  z.object({ name: z.literal("time.get"), timesheetId: z.uuid() }).strict(),
  z
    .object({
      name: z.literal("time.list"),
      ...taskSelection,
      ...pageInput,
      sort: z.enum(TIMESHEET_SORTS).optional(),
      createdBy: z.string().max(128).optional(),
    })
    .strict(),
  z
    .object({
      name: z.literal("document.list"),
      ...pageInput,
      sort: z.enum(DOCUMENT_SORTS).optional(),
      query: z.string().max(200).optional(),
      archived: z.boolean().optional(),
      label: z.string().max(80).optional(),
      collectionId: z.uuid().optional(),
    })
    .strict(),
  z
    .object({ name: z.literal("collection.get"), collectionId: z.uuid() })
    .strict(),
  z
    .object({
      name: z.literal("collection.list"),
      ...pageInput,
      sort: z.enum(COLLECTION_SORTS).optional(),
      query: z.string().max(200).optional(),
      archived: z.boolean().optional(),
    })
    .strict(),
  z.object({ name: z.literal("file.get"), fileId: z.uuid() }).strict(),
  z.object({ name: z.literal("file.read"), fileId: z.uuid() }).strict(),
  z
    .object({
      name: z.literal("file.list"),
      ...pageInput,
      sort: z.enum(FILE_SORTS).optional(),
      query: z.string().max(200).optional(),
      type: z.string().max(50).optional(),
      archived: z.boolean().optional(),
      label: z.string().max(80).optional(),
    })
    .strict(),
  z
    .object({
      name: z.literal("skill.list"),
      ...pageInput,
      sort: z.enum(SKILL_SORTS).optional(),
      query: z.string().max(200).optional(),
      archived: z.boolean().optional(),
    })
    .strict(),
  z.object({ name: z.literal("skill.get"), skillId: z.uuid() }).strict(),
  z.object({ name: z.literal("skill.export"), skillId: z.uuid() }).strict(),
  z
    .object({
      name: z.literal("skill.proposeChange"),
      skillId: z.uuid(),
      title: z.string().min(1).max(200),
      instructions: z.string().max(100000),
      editToken: z.number().int().nonnegative(),
    })
    .strict(),

  z
    .object({
      name: z.literal("document.proposeChange"),
      documentId: z.uuid(),
      title: z.string().min(1).max(200),
      body: z.string().max(100000),
      editToken: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      name: z.literal("task.capture"),
      title: z.string().min(1).max(200),
      messageId: z.uuid(),
    })
    .strict(),
  z
    .object({
      name: z.literal("task.create"),
      title: z.string().min(1).max(200),
      notes: z.string().max(16000).default(""),
    })
    .strict(),
  z
    .object({
      name: z.literal("human.ask"),
      requestId: z.uuid(),
      body: z.string().min(1).max(16000),
    })
    .strict(),
  z
    .object({
      name: z.literal("file.create"),
      requestId: z.uuid(),
      title: z.string().min(1).max(200),
      type: z.string().min(1).max(50),
      labels: z.array(z.string().max(80)).max(20).default([]),
      projectId: z.uuid().optional(),
      visibility: z.enum(["user", "workspace"]),
      mediaType: z.enum([
        "text/plain",
        "text/markdown",
        "text/html",
        "application/json",
      ]),
      text: z.string().max(64000),
    })
    .strict(),
  z
    .object({
      name: z.literal("connection.request"),
      connectionId: z.uuid(),
      requestId: z.uuid(),
      action: z.string().max(200),
      target: z.string().max(2000),
      arguments: z.record(z.string().max(200), z.json()),
    })
    .strict(),
  z
    .object({
      name: z.literal("skill.read"),
      skillId: z.uuid(),
      path: z.string().max(500),
    })
    .strict(),
  z
    .object({
      name: z.literal("chat.read"),
      after: z.number().int().nonnegative().default(0),
    })
    .strict(),
  z
    .object({
      name: z.literal("message.create"),
      requestId: z.uuid(),
      body: z.string().min(1).max(16000),
      replyTo: z.uuid().optional(),
      mentionUserIds: z.array(z.string().min(1).max(128)).max(50).optional(),
      fileIds: z.array(z.uuid()).max(30).optional(),
    })
    .strict(),
  z.object({
    name: z.literal("agent.request"),
    requestId: z.uuid(),
    agentId: z.uuid(),
    body: z.string().min(1).max(16000),
  }),
  z.object({ name: z.literal("task.get"), taskId: z.uuid() }),
  z.object({
    name: z.literal("task.proposeCompletion"),
    taskId: z.uuid(),
    requestId: z.uuid(),
    body: z.string().max(16000),
  }),
  z.object({ name: z.literal("document.get"), documentId: z.uuid() }),
]);
export const runToolSchema = z.toJSONSchema(toolInput, { io: "input" });

/** Called from a trusted runtime closure; no browser-controlled agent identity or reusable tool token. */
export function createRunTools(
  db: Database,
  boss: PgBoss,
  options: {
    connections?: ConnectionOptions;
    storage?: FileStorage;
    models?: ModelAuthorization;
    native: NativeSessionStorage;
    cursors?: CursorCodec;
  },
) {
  return async (
    attempt: Attempt,
    value: unknown,
    signal: AbortSignal = AbortSignal.timeout(300000),
    toolCallId: string,
  ) => {
    signal.throwIfAborted();
    if (!toolCallId || toolCallId.length > 200)
      throw new DomainError("invalid", "Native tool-call identity required");
    const parsed = toolInput.parse(value);
    const requestId = effectRequestId(attempt.runId, toolCallId);
    const input = "requestId" in parsed ? { ...parsed, requestId } : parsed;
    if (
      [
        "message.create",
        "task.proposeCompletion",
        "file.create",
        "connection.request",
        "human.ask",
        "agent.request",
      ].includes(input.name)
    ) {
      await withRunEffect(
        db,
        attempt,
        { toolCallId, toolName: input.name, input },
        async () => ({ requestId }),
        validateSchedule,
        options.native,
        authorizeRunSources,
      );
    }
    if (input.name === "file.read") {
      const storage = required(options.storage, "unavailable");
      const authorize = () =>
        withRunAttempt(
          db,
          attempt,
          async (c, run) => {
            await requireFileAudience(
              c,
              input.fileId,
              run.inputs.audience.humans,
            );
            await getFile(c, input.fileId);
            if (run.sessionId)
              await recordSessionSources(c, run.sessionId, [
                { type: "file", id: input.fileId },
              ]);
            return { workspaceId: c.workspaceId, actor: c.actor };
          },
          validateSchedule,
          options.native,
          authorizeRunSources,
        );
      const scope = await authorize();
      const bytes = await readFile(
        db,
        storage,
        scope.workspaceId,
        scope.actor,
        input.fileId,
      );
      signal.throwIfAborted();
      await authorize();
      return { base64: Buffer.from(bytes).toString("base64") };
    }
    if (input.name === "agent.request") {
      const parent = await withRunAttempt(
        db,
        attempt,
        (c, run) => authorizePeerRun(c, run.id, input.agentId),
        validateSchedule,
        options.native,
        authorizeRunSources,
      );
      const model = await prepareRunModel(
        db,
        parent.workspaceId,
        { userId: parent.sponsorId },
        {
          agentId: input.agentId,
          type: "prompt",
          requestId: `peer:${parent.id}:${input.requestId}`,
        },
        options.models,
      );
      signal.throwIfAborted();
      return withRunAttempt(
        db,
        attempt,
        (c, run) => requestPeerRun(c, boss, run.id, input, model),
        validateSchedule,
        options.native,
        authorizeRunSources,
      );
    }
    if (input.name === "human.ask") {
      const question = await withRunAttempt(
        db,
        attempt,
        (c, run) => createRunQuestion(c, run.id, input),
        validateSchedule,
        options.native,
        authorizeRunSources,
      );
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        const current = await withRunAttempt(
          db,
          attempt,
          (c) => getRunQuestion(c, question.id),
          validateSchedule,
          options.native,
          authorizeRunSources,
        );
        if (current.answer !== null) return { answer: current.answer };
        await Bun.sleep(250);
      }
      throw new DomainError("unavailable", "Human answer deadline");
    }
    if (input.name === "file.create") {
      if (!options.storage)
        throw new DomainError("unavailable", "File storage unavailable");
      const scope = await withRunAttempt(
        db,
        attempt,
        async (c, run) => ({
          workspaceId: c.workspaceId,
          actor: c.actor,
          environmentGeneration: run.environmentGeneration,
        }),
        validateSchedule,
        options.native,
        authorizeRunSources,
      );
      const { name: _name, text, ...file } = input;
      return createFile(
        db,
        options.storage,
        scope.workspaceId,
        scope.actor,
        { ...file, sourceRunId: attempt.runId },
        new TextEncoder().encode(text),
        async (c, sourceRunId) => {
          signal.throwIfAborted();
          if (sourceRunId !== attempt.runId) throw new DomainError("forbidden");
          const run = await assertRunAttempt(
            c,
            attempt,
            validateSchedule,
            options.native,
            authorizeRunSources,
          );
          if (run.environmentGeneration !== scope.environmentGeneration)
            throw new DomainError("forbidden", "Execution generation changed");
        },
      );
    }
    if (input.name === "connection.request" || input.name === "skill.read") {
      const scope = await withRunAttempt(
        db,
        attempt,
        async (c, run) => ({
          workspaceId: c.workspaceId,
          sponsorId: c.actor.userId,
          environmentGeneration: run.environmentGeneration,
        }),
        validateSchedule,
        options.native,
        authorizeRunSources,
      );
      if (input.name === "skill.read") {
        if (!options.storage)
          throw new DomainError("unavailable", "Skill storage unavailable");
        const bytes = await readRunSkillFile(db, options.storage, {
          ...scope,
          runId: attempt.runId,
          skillId: input.skillId,
          path: input.path,
          attempt,
          native: options.native,
        });
        await withRunAttempt(
          db,
          attempt,
          async () => {},
          validateSchedule,
          options.native,
          authorizeRunSources,
        );
        return { base64: Buffer.from(bytes).toString("base64") };
      }
      if (!options.connections)
        throw new DomainError(
          "unavailable",
          "Connection credential scope not configured",
        );
      const service = connectionService(
        db,
        scope.workspaceId,
        { userId: scope.sponsorId, agentId: attempt.agentId },
        {
          ...options.connections,
          http: { ...options.connections.http, signal },
          native: options.native,
        },
      );
      const { name: _name, ...operationInput } = input;
      let operation = await service.requestOperation({
        ...operationInput,
        runId: attempt.runId,
        attempt: attempt.attempt,
        launchKey: attempt.launchKey,
        environmentGeneration: scope.environmentGeneration,
      });
      const deadline = Date.now() + 300000;
      while (
        ["awaiting_approval", "approved", "executing"].includes(operation.state)
      ) {
        signal.throwIfAborted();
        if (Date.now() >= deadline)
          throw new DomainError("unavailable", "Operation approval deadline");
        await withRunAttempt(
          db,
          attempt,
          async () => {},
          validateSchedule,
          options.native,
          authorizeRunSources,
        );
        if (operation.state === "approved")
          operation = await service.executeOperation(operation.id);
        if (
          !["awaiting_approval", "approved", "executing"].includes(
            operation.state,
          )
        )
          break;
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new DomainError("unavailable", "Run stopped"));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, 1000);
          signal.addEventListener("abort", abort, { once: true });
        });
        operation = await service.readOperation(operation.id);
      }
      await withRunAttempt(
        db,
        attempt,
        async (c, run) => {
          if (run.sessionId) await invalidateSessionSources(c, run.sessionId);
        },
        validateSchedule,
        options.native,
        authorizeRunSources,
      );
      return service.readOperation(operation.id);
    }
    if (
      input.name === "message.create" ||
      input.name === "task.proposeCompletion"
    ) {
      const scope = await withRunAttempt(
        db,
        attempt,
        async (c, run) => {
          if (input.name === "task.proposeCompletion") {
            if (input.taskId !== run.taskId) throw new DomainError("forbidden");
            await getTask(c, input.taskId);
          }
          return {
            workspaceId: c.workspaceId,
            actor: c.actor,
            chatId: run.chatId,
          };
        },
        validateSchedule,
        options.native,
        authorizeRunSources,
      );
      return createMessage(
        db,
        options.native,
        scope.workspaceId,
        scope.actor,
        scope.chatId,
        {
          requestId,
          ...(input.name === "message.create"
            ? {
                replyTo: input.replyTo,
                mentionUserIds: input.mentionUserIds,
                fileIds: input.fileIds,
              }
            : {}),
          body:
            input.name === "message.create"
              ? input.body
              : `Proposed completion of ${input.taskId}: ${input.body}`,
        },
        async (c) => {
          signal.throwIfAborted();
          const run = await assertRunAttempt(
            c,
            attempt,
            validateSchedule,
            options.native,
            authorizeRunSources,
          );
          if (input.name === "message.create") {
            const audience = await getChatAudience(c, run.chatId);
            if (
              input.mentionUserIds?.some(
                (id) =>
                  !run.inputs.audience.humans.includes(id) ||
                  !audience.humans.includes(id),
              )
            )
              throw new DomainError(
                "forbidden",
                "Mention outside accepted audience",
              );
            if (input.replyTo)
              await getMessage(c, run.chatId, input.replyTo, options.native);
            for (const fileId of input.fileIds ?? []) {
              const file = await requireFileAudience(
                c,
                fileId,
                [
                  ...new Set([
                    ...run.inputs.audience.humans,
                    ...audience.humans,
                  ]),
                ],
                true,
              );
              if (file.visibility === "user")
                throw new DomainError(
                  "forbidden",
                  "Private attachments require the actual human custodian",
                );
            }
          }
        },
      );
    }
    const operation = async (
      c: Parameters<Parameters<typeof withRunAttempt>[2]>[0],
      run: Parameters<Parameters<typeof withRunAttempt>[2]>[1],
    ) => {
      signal.throwIfAborted();
      c = { ...c, cursors: options.cursors };
      const remember = async (sources: SessionSource[]) => {
        if (run.sessionId)
          await recordSessionSources(c, run.sessionId, sources);
      };
      if (
        run.sessionId &&
        [
          "run.list",
          "run.activity",
          "connection.get",
          "connection.list",
          "schedule.get",
          "schedule.history",
          "collection.get",
          "collection.list",
        ].includes(input.name)
      )
        await invalidateSessionSources(c, run.sessionId);
      const project = async () => {
        const chat = await getChat(c, run.chatId);
        const id = required(chat.projectId ?? undefined, "forbidden");
        const audience = await getProjectAudience(c, id);
        if (
          run.inputs.audience.humans.some((human) => !audience.includes(human))
        )
          throw new DomainError("forbidden", "Project audience mismatch");
        if (
          [
            "task.update",
            "task.capture",
            "task.status",
            "task.link.create",
            "task.link.delete",
            "task.comment.create",
            "task.comment.update",
            "task.comment.delete",
          ].includes(input.name) &&
          audience.some((human) => !run.inputs.audience.humans.includes(human))
        )
          throw new DomainError(
            "forbidden",
            "Task mutation widens the Run audience",
          );
        return id;
      };
      if ("taskId" in input && input.name !== "task.get") {
        const task = await getTask(c, input.taskId);
        if (task.projectId !== (await project()))
          throw new DomainError("forbidden", "Task outside accepted Project");
        await remember([{ type: "task", id: task.id }]);
      }
      if ("commentId" in input) {
        const comment = await getTaskComment(c, input.commentId);
        const task = await getTask(c, comment.taskId);
        if (task.projectId !== (await project()))
          throw new DomainError(
            "forbidden",
            "Comment outside accepted Project",
          );
        await remember([{ type: "task", id: task.id }]);
      }
      switch (input.name) {
        case "chat.get":
          return getChat(c, run.chatId);
        case "chat.participants":
          return getParticipants(c, run.chatId, toolArguments(input));
        case "message.get": {
          const message = await getMessage(
            c,
            run.chatId,
            input.messageId,
            options.native,
          );
          await remember(
            message.fileIds.map((fileId) => ({
              type: "attachment",
              chatId: run.chatId,
              messageId: message.id,
              fileId,
            })),
          );
          return message;
        }
        case "run.get":
          return getRun(c, run.id);
        case "run.list":
          return getRuns(c, { ...toolArguments(input), chatId: run.chatId });
        case "run.activity":
          return getRunActivity(c, run.id, input.after);
        case "run.usage":
          return getRunUsage(c, run.id);
        case "connection.get":
          if (
            !run.inputs.grants.some(
              (grant) => grant.connectionId === input.connectionId,
            )
          )
            throw new DomainError("forbidden");
          return getConnection(c, input.connectionId);
        case "connection.list":
          return {
            items: await Promise.all(
              [
                ...new Set(
                  run.inputs.grants.map((grant) => grant.connectionId),
                ),
              ].map((id) => getConnection(c, id)),
            ),
            next: null,
          };
        case "schedule.get":
        case "schedule.history": {
          const schedule = await getSchedule(c, input.scheduleId);
          if (schedule.chatId !== run.chatId)
            throw new DomainError("forbidden");
          return input.name === "schedule.get"
            ? schedule
            : getScheduleHistory(c, input.scheduleId, toolArguments(input));
        }
        case "project.get":
          return getProject(c, await project());
        case "project.members":
          return getProjectMembers(c, await project(), toolArguments(input));
        case "task.list": {
          const page = await getTasks(c, {
            ...toolArguments(input),
            projectId: await project(),
          });
          await remember(
            page.items.map((task) => ({ type: "task", id: task.id })),
          );
          return page;
        }
        case "task.update":
          return updateTask(c, input.taskId, {
            ...input,
            dueAt: input.dueAt == null ? input.dueAt : new Date(input.dueAt),
          });
        case "task.status":
          return setTaskStatus(c, input.taskId, input);
        case "task.links": {
          const page = await getTaskLinks(
            c,
            input.taskId,
            toolArguments(input),
          );
          for (const link of page.items)
            await authorizeTaskLink(
              c,
              run.inputs.audience.humans,
              run.chatId,
              link,
            );
          await remember(
            page.items.flatMap((link): SessionSource[] =>
              link.type === "file" || link.type === "document"
                ? [{ type: link.type, id: link.reference }]
                : [],
            ),
          );
          return page;
        }
        case "task.link.create":
          await authorizeTaskLink(
            c,
            run.inputs.audience.humans,
            run.chatId,
            input,
          );
          await createTaskLink(c, input.taskId, input);
          return {
            taskId: input.taskId,
            type: input.type,
            reference: input.reference,
          };
        case "task.link.delete":
          await deleteTaskLink(c, input.taskId, input.linkId);
          return { taskId: input.taskId, linkId: input.linkId };
        case "task.comment.create":
          return createTaskComment(c, toolArguments(input));
        case "task.comment.get":
          return getTaskComment(c, input.commentId);
        case "task.comment.list":
          return getTaskComments(c, toolArguments(input));
        case "task.comment.update":
          return updateTaskComment(c, input.commentId, { body: input.body });
        case "task.comment.delete":
          await deleteTaskComment(c, input.commentId);
          return { commentId: input.commentId };
        case "time.list": {
          const { name: _name, ...filter } = input;
          return getTimesheets(c, filter);
        }
        case "time.get": {
          const entry = await getTimesheet(c, input.timesheetId);
          const task = await getTask(c, entry.taskId);
          if (task.projectId !== (await project()))
            throw new DomainError(
              "forbidden",
              "Timesheet outside accepted Project",
            );
          await remember([{ type: "task", id: task.id }]);
          return entry;
        }
        case "document.list": {
          const page = await getDocuments(c, {
            ...toolArguments(input),
            projectId: await project(),
            visibility: "workspace",
          });
          await remember(
            page.items.map((document) => ({
              type: "document",
              id: document.id,
            })),
          );
          return page;
        }
        case "collection.get": {
          const collection = await getCollection(c, input.collectionId);
          if (collection.projectId !== (await project()))
            throw new DomainError("forbidden");
          return collection;
        }
        case "collection.list":
          return getCollections(c, {
            ...toolArguments(input),
            projectId: await project(),
          });
        case "file.get":
          await requireFileAudience(
            c,
            input.fileId,
            run.inputs.audience.humans,
          );
          await remember([{ type: "file", id: input.fileId }]);
          return getFile(c, input.fileId);
        case "file.list": {
          const page = await getFiles(c, {
            ...toolArguments(input),
            projectId: await project(),
            visibility: "workspace",
          });
          for (const file of page.items)
            await requireFileAudience(c, file.id, run.inputs.audience.humans);
          await remember(
            page.items.map((file) => ({ type: "file", id: file.id })),
          );
          return page;
        }
        case "skill.list": {
          const page = await getSkills(c, toolArguments(input));
          const accepted = new Set(
            run.inputs.skills.map((skill) => skill.documentId),
          );
          if (page.items.some((skill) => !accepted.has(skill.id)))
            throw new DomainError("forbidden");
          for (const skill of page.items) {
            const audience = await getSkillAudience(c, skill.id);
            if (
              run.inputs.audience.humans.some(
                (human) => !audience.includes(human),
              )
            )
              throw new DomainError("forbidden");
          }
          return page;
        }
        case "chat.read": {
          const messages = await getMessages(
            c,
            run.chatId,
            input.after,
            options.native,
          );
          await remember(
            messages.flatMap((message) =>
              message.fileIds.map(
                (fileId): SessionSource => ({
                  type: "attachment",
                  chatId: run.chatId,
                  messageId: message.id,
                  fileId,
                }),
              ),
            ),
          );
          return messages;
        }
        case "task.capture": {
          await getChat(c, run.chatId, true);
          const task = await captureTask(c, options.native, {
            projectId: await project(),
            chatId: run.chatId,
            messageId: input.messageId,
            title: input.title,
            ownerId: run.sponsorId,
          });
          await remember([{ type: "task", id: task.id }]);
          return task;
        }
        case "task.create": {
          const chat = await getChat(c, run.chatId, true);
          if (!chat.projectId)
            throw new DomainError(
              "invalid",
              "Task requires the accepted Project",
            );
          const audience = await getProjectAudience(c, chat.projectId);
          if (audience.some((id) => !run.inputs.audience.humans.includes(id)))
            throw new DomainError(
              "forbidden",
              "Task publication widens the Run audience",
            );
          const task = await createTask(c, {
            projectId: chat.projectId,
            title: input.title,
            notes: input.notes,
            ownerId: run.sponsorId,
          });
          await remember([{ type: "task", id: task.id }]);
          return task;
        }
        case "task.get": {
          const task = await getTask(c, input.taskId);
          if (task.projectId !== (await project()))
            throw new DomainError("forbidden", "Task outside accepted Project");
          const audience = await getProjectAudience(c, task.projectId);
          if (run.inputs.audience.humans.some((id) => !audience.includes(id)))
            throw new DomainError("forbidden", "Task audience mismatch");
          await remember([{ type: "task", id: task.id }]);
          return input.taskId === run.taskId
            ? required(run.inputs.context?.task ?? undefined, "forbidden")
            : task;
        }
        case "skill.get":
        case "skill.export":
        case "skill.proposeChange": {
          const selected = required(
            run.inputs.skills.find(
              (skill) => skill.documentId === input.skillId,
            ),
            "forbidden",
          );
          const skill = await getSkill(c, input.skillId);
          const audience = await getSkillAudience(c, skill.id);
          if (run.inputs.audience.humans.some((id) => !audience.includes(id)))
            throw new DomainError("forbidden", "Skill audience mismatch");
          if (input.name === "skill.export") {
            if (skill.editToken !== selected.editToken)
              throw new DomainError(
                "conflict",
                "Skill differs from accepted export source",
              );
            for (const file of skill.supportingFiles)
              await requireFileAudience(
                c,
                file.fileId,
                run.inputs.audience.humans,
              );
            await remember(
              skill.supportingFiles.map((file) => ({
                type: "skill-file",
                skillId: skill.id,
                ...file,
              })),
            );
            return exportSkill(c, skill.id);
          }
          if (input.name === "skill.proposeChange") {
            if (input.editToken !== selected.editToken)
              throw new DomainError(
                "conflict",
                "Proposal does not match accepted source",
              );
            if (audience.some((id) => !run.inputs.audience.humans.includes(id)))
              throw new DomainError(
                "forbidden",
                "Proposal publication widens the Run audience",
              );
            return proposeSkillChange(c, skill.id, input);
          }
          return {
            id: skill.id,
            title: selected.title,
            instructions: selected.instructions,
          };
        }
        case "document.get":
        case "document.proposeChange": {
          const selected = run.inputs.context?.documents.find(
            (d) => d.id === input.documentId,
          );
          const doc = await getDocument(c, input.documentId);
          if (!selected && doc.projectId !== (await project()))
            throw new DomainError(
              "forbidden",
              "Document outside accepted Project",
            );
          const audience = await getDocumentAudience(c, input.documentId);
          if (run.inputs.audience.humans.some((id) => !audience.includes(id)))
            throw new DomainError("forbidden", "Document audience mismatch");
          await remember([{ type: "document", id: doc.id }]);
          if (input.name === "document.proposeChange") {
            if (input.editToken !== (selected?.editToken ?? doc.editToken))
              throw new DomainError(
                "conflict",
                "Proposal does not match accepted source",
              );
            if (audience.some((id) => !run.inputs.audience.humans.includes(id)))
              throw new DomainError(
                "forbidden",
                "Proposal publication widens the Run audience",
              );
            return proposeDocumentChange(c, doc.id, input);
          }
          return selected
            ? { id: doc.id, title: selected.title, body: selected.body }
            : doc;
        }
      }
    };
    if (
      [
        "task.create",
        "task.capture",
        "task.update",
        "task.status",
        "task.link.create",
        "task.link.delete",
        "task.comment.create",
        "task.comment.update",
        "task.comment.delete",
        "skill.proposeChange",
        "document.proposeChange",
      ].includes(input.name)
    ) {
      const result = await withRunEffect(
        db,
        attempt,
        { toolCallId, toolName: input.name, input },
        operation,
        validateSchedule,
        options.native,
        authorizeRunSources,
      );
      if (input.name === "task.create" || input.name === "task.capture") {
        const saved = z
          .object({ id: z.uuid(), title: z.string() })
          .parse(result);
        const scope = await withRunAttempt(
          db,
          attempt,
          async (c, run) => {
            const task = await getTask(c, saved.id);
            const audience = await getProjectAudience(c, task.projectId);
            if (run.inputs.audience.humans.some((id) => !audience.includes(id)))
              throw new DomainError("forbidden");
            return {
              workspaceId: c.workspaceId,
              actor: c.actor,
              chatId: run.chatId,
            };
          },
          validateSchedule,
          options.native,
          authorizeRunSources,
        );
        await createMessage(
          db,
          options.native,
          scope.workspaceId,
          scope.actor,
          scope.chatId,
          {
            requestId: effectRequestId(
              attempt.runId,
              `announcement:${toolCallId}`,
            ),
            body: `Created Task ${saved.id}: ${saved.title}`,
          },
          async (c) => {
            signal.throwIfAborted();
            await assertRunAttempt(
              c,
              attempt,
              validateSchedule,
              options.native,
              authorizeRunSources,
            );
          },
        );
      }
      return result;
    }
    return withRunAttempt(
      db,
      attempt,
      operation,
      validateSchedule,
      options.native,
      authorizeRunSources,
    );
  };
}

function toolArguments<T extends { name: string }>(input: T) {
  const { name: _name, ...fields } = input;
  return fields;
}

async function authorizeTaskLink(
  c: Parameters<typeof getTask>[0],
  audience: string[],
  chatId: string,
  link: { type: string; reference: string },
) {
  if (link.type === "file") {
    await requireFileAudience(c, link.reference, audience);
    await getFile(c, link.reference);
  } else if (link.type === "document") {
    await getDocument(c, link.reference);
    const readers = await getDocumentAudience(c, link.reference);
    if (audience.some((human) => !readers.includes(human)))
      throw new DomainError("forbidden");
  } else if (link.type === "chat") {
    if (link.reference !== chatId) throw new DomainError("forbidden");
    await getChat(c, link.reference);
  } else {
    const url = new URL(link.reference);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new DomainError("invalid");
  }
}

export function effectRequestId(runId: string, toolCallId: string) {
  const bytes = createHash("sha256")
    .update(JSON.stringify([runId, toolCallId]))
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createNativeRunTools(
  db: Database,
  boss: PgBoss,
  attempt: Attempt,
  options: Parameters<typeof createRunTools>[2],
  signal: AbortSignal,
): ToolsInput {
  const execute = createRunTools(db, boss, options);
  const tools: ToolsInput = Object.fromEntries(
    toolInput.options.map((schema) => {
      const name = schema.shape.name.value;
      const shape: Record<string, z.ZodType> = Object.fromEntries(
        Object.entries(schema.shape).filter(
          ([key]) => key !== "name" && key !== "requestId",
        ),
      );
      if (name === "task.update") {
        shape.ownerId = z.string().min(1).max(128).optional();
        shape.assigneeUserIds = z
          .array(z.string().min(1).max(128))
          .max(20)
          .optional();
        shape.assigneeAgentIds = z.array(z.uuid()).max(20).optional();
      }
      if (name === "task.status")
        shape.status = z.enum(["todo", "doing", "done"]);
      const inputSchema = z.object(shape).strict();
      return [
        name.replaceAll(".", "_"),
        createTool({
          id: name.replaceAll(".", "_"),
          description:
            name === "task.update"
              ? "Update a Task. Ordinary edits execute as the Agent. Including ownerId or either assignee list requests actual human approval of the entire exact payload; no field changes before approval. A denied request is not success."
              : name === "task.status"
                ? "Set Task status. Todo and doing execute as the Agent. Done requests actual human approval of the exact payload. A denied request is not success."
                : `Perform ${name} under the current Run's accepted scope and current domain authorization. Human-only operations require a human; this tool never impersonates one.`,
          inputSchema,
          execute: async (input, context) => {
            const toolCallId = required(
              context?.agent?.toolCallId,
              "forbidden",
            );
            const abort = context?.abortSignal
              ? AbortSignal.any([signal, context.abortSignal])
              : signal;
            if (
              (name === "task.update" &&
                (input.ownerId !== undefined ||
                  input.assigneeUserIds !== undefined ||
                  input.assigneeAgentIds !== undefined)) ||
              (name === "task.status" && input.status === "done")
            ) {
              const { taskId, ...fields } = input;
              return requestNativeAction(
                db,
                attempt,
                {
                  toolCallId,
                  input: nativeActionInput.parse({
                    ...fields,
                    type: name,
                    id: taskId,
                  }),
                },
                abort,
                options.native,
              );
            }
            return execute(
              attempt,
              {
                ...input,
                name,
                ...("requestId" in schema.shape
                  ? { requestId: effectRequestId(attempt.runId, toolCallId) }
                  : {}),
              },
              abort,
              toolCallId,
            );
          },
        }),
      ];
    }),
  );
  for (const schema of nativeActionInput.options) {
    const type = schema.shape.type.value;
    if (type === "task.update" || type === "task.status") continue;
    const id = `request_${type.replaceAll(".", "_")}`;
    tools[id] = createTool({
      id,
      description: `Request ${type}. This does not perform the effect: the actual human must approve the exact payload and execute it under their current permissions. A denied request is not success.`,
      inputSchema: z
        .object(
          Object.fromEntries(
            Object.entries(schema.shape).filter(([key]) => key !== "type"),
          ),
        )
        .strict(),
      execute: async (input, context) => {
        const toolCallId = required(context?.agent?.toolCallId, "forbidden");
        const abort = context?.abortSignal
          ? AbortSignal.any([signal, context.abortSignal])
          : signal;
        return requestNativeAction(
          db,
          attempt,
          { toolCallId, input: nativeActionInput.parse({ ...input, type }) },
          abort,
          options.native,
        );
      },
    });
  }
  return tools;
}
