import { type ArtifactStorage, createArtifact } from "@otto/artifacts";
import { validateAutomation } from "@otto/automations";
import { getOperation } from "@otto/connections";
import {
  createMessage,
  getConversation,
  getMessages,
} from "@otto/conversations";
import type { Database } from "@otto/db";
import {
  getDocument,
  getDocumentAudience,
  proposeDocumentChange,
} from "@otto/documents";
import { getProjectAudience } from "@otto/projects";
import {
  createRunQuestion,
  getRunQuestion,
  type Harnesses,
  requestPeerRun,
} from "@otto/runs";
import {
  type Attempt,
  assertRunAttempt,
  withRunAttempt,
} from "@otto/runs/runtime";
import { DomainError, required } from "@otto/shared";

import { createTask, getTask } from "@otto/tasks";
import { inWorkspace } from "@otto/workspaces";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { type ConnectionOptions, connectionService } from "./connections";
import { readRunSkillFile } from "./skill-files";

const toolInput = z.discriminatedUnion("name", [
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
      name: z.literal("artifact.create"),
      requestId: z.uuid(),
      title: z.string().min(1).max(200),
      type: z.string().min(1).max(50),
      labels: z.array(z.string().max(80)).max(20).default([]),
      projectId: z.uuid().optional(),
      access: z.enum(["inherited", "restricted"]),
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
      documentId: z.uuid(),
      path: z.string().max(500),
    })
    .strict(),
  z
    .object({
      name: z.literal("conversation.read"),
      after: z.number().int().nonnegative().default(0),
    })
    .strict(),
  z.object({
    name: z.literal("message.create"),
    requestId: z.uuid(),
    body: z.string().min(1).max(16000),
  }),
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
/** Called from a trusted runtime closure; no browser-controlled agent identity or reusable tool token. */
export function createRunTools(
  db: Database,
  boss: PgBoss,
  options: {
    connections?: ConnectionOptions;
    storage?: ArtifactStorage;
    harnesses?: Harnesses;
  } = {},
) {
  return async (
    attempt: Attempt,
    value: unknown,
    signal: AbortSignal = AbortSignal.timeout(300000),
  ) => {
    const input = toolInput.parse(value);
    if (input.name === "human.ask") {
      const question = await withRunAttempt(
        db,
        attempt,
        (c, run) => createRunQuestion(c, run.id, input),
        validateAutomation,
      );
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        const current = await withRunAttempt(
          db,
          attempt,
          (c) => getRunQuestion(c, question.id),
          validateAutomation,
        );
        if (current.answer !== null) return { answer: current.answer };
        await Bun.sleep(250);
      }
      throw new DomainError("unavailable", "Human answer deadline");
    }
    if (input.name === "artifact.create") {
      if (!options.storage)
        throw new DomainError("unavailable", "Artifact storage unavailable");
      const scope = await withRunAttempt(
        db,
        attempt,
        async (c, run) => ({
          workspaceId: c.workspaceId,
          actor: c.actor,
          environmentGeneration: run.environmentGeneration,
        }),
        validateAutomation,
      );
      const { name: _name, text, ...artifact } = input;
      return createArtifact(
        db,
        options.storage,
        scope.workspaceId,
        scope.actor,
        { ...artifact, sourceRunId: attempt.runId },
        new TextEncoder().encode(text),
        async (c, sourceRunId) => {
          if (sourceRunId !== attempt.runId) throw new DomainError("forbidden");
          const run = await assertRunAttempt(c, attempt, validateAutomation);
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
        validateAutomation,
      );
      if (input.name === "skill.read") {
        if (!options.storage)
          throw new DomainError("unavailable", "Skill storage unavailable");
        const bytes = await readRunSkillFile(db, options.storage, {
          ...scope,
          runId: attempt.runId,
          documentId: input.documentId,
          path: input.path,
        });
        await withRunAttempt(db, attempt, async () => {}, validateAutomation);
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
        options.connections,
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
        await withRunAttempt(db, attempt, async () => {}, validateAutomation);
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
        operation = await inWorkspace(
          db,
          scope.workspaceId,
          { userId: scope.sponsorId },
          (c) => getOperation(c, operation.id),
          false,
        );
      }
      await withRunAttempt(db, attempt, async () => {}, validateAutomation);
      return operation;
    }
    return withRunAttempt(
      db,
      attempt,
      async (c, run) => {
        switch (input.name) {
          case "conversation.read":
            return getMessages(c, run.conversationId, input.after);
          case "message.create":
            return createMessage(c, run.conversationId, input);
          case "agent.request":
            return requestPeerRun(c, boss, run.id, input, options.harnesses);
          case "task.create": {
            const conversation = await getConversation(
              c,
              run.conversationId,
              true,
            );
            if (!conversation.projectId)
              throw new DomainError(
                "invalid",
                "Task requires the accepted Project",
              );
            const audience = await getProjectAudience(
              c,
              conversation.projectId,
            );
            if (audience.some((id) => !run.inputs.audience.humans.includes(id)))
              throw new DomainError(
                "forbidden",
                "Task publication widens the Run audience",
              );
            const task = await createTask(c, {
              projectId: conversation.projectId,
              title: input.title,
              notes: input.notes,
              ownerId: run.sponsorId,
            });
            await createMessage(c, run.conversationId, {
              requestId: crypto.randomUUID(),
              body: `Created Task ${task.id}: ${task.title}`,
            });
            return task;
          }
          case "task.get":
          case "task.proposeCompletion": {
            if (input.taskId !== run.taskId)
              throw new DomainError(
                "forbidden",
                "Task was not accepted for this Run",
              );
            const task = await getTask(c, input.taskId);
            const audience = await getProjectAudience(c, task.projectId);
            if (run.inputs.audience.humans.some((id) => !audience.includes(id)))
              throw new DomainError("forbidden", "Task audience mismatch");
            if (input.name === "task.proposeCompletion")
              return createMessage(c, run.conversationId, {
                requestId: input.requestId,
                body: `Proposed completion of ${task.id}: ${input.body}`,
              });
            return required(run.inputs.context?.task ?? undefined, "forbidden");
          }
          case "document.get":
          case "document.proposeChange": {
            const selected = run.inputs.context?.documents.find(
              (d) => d.id === input.documentId,
            );
            const skill = run.inputs.skills.find(
              (s) => s.documentId === input.documentId,
            );
            if (!selected && !skill)
              throw new DomainError(
                "forbidden",
                "Document was not accepted for this Run",
              );
            // Ordinary direct reads still require the Agent's own access; accepted
            // restricted input snapshots do not grant arbitrary live document access.
            const doc = await getDocument(c, input.documentId);
            const audience = await getDocumentAudience(c, input.documentId);
            if (run.inputs.audience.humans.some((id) => !audience.includes(id)))
              throw new DomainError("forbidden", "Document audience mismatch");
            if (input.name === "document.proposeChange") {
              if (input.editToken !== (selected?.editToken ?? skill?.editToken))
                throw new DomainError(
                  "conflict",
                  "Proposal does not match accepted source",
                );
              if (
                audience.some((id) => !run.inputs.audience.humans.includes(id))
              )
                throw new DomainError(
                  "forbidden",
                  "Proposal publication widens the Run audience",
                );
              return proposeDocumentChange(c, doc.id, input);
            }
            return {
              id: doc.id,
              title: selected?.title ?? skill?.title,
              body: selected?.body ?? skill?.instructions,
            };
          }
        }
      },
      validateAutomation,
    );
  };
}
