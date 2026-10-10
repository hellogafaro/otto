import { randomBytes } from "node:crypto";
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import { createTool } from "@mastra/core/tools";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { startQueue } from "../apps/server/src/queue";
import { authorizeRunSources } from "../apps/server/src/run-sources";
import { continueTaskReview } from "../apps/server/src/task-review";
import { effectRequestId } from "../apps/server/src/tools";
import { createAgent } from "../packages/agents/src";
import {
  createChat,
  createMessage,
  createParticipant,
  deleteParticipant,
  publishNativeMessage,
} from "../packages/chats/src";
import { createEnvironment } from "../packages/environments/src";
import {
  createDocument,
  createFile,
  getDocument,
  readFile,
  snapshotRunDocuments,
  updateDocument,
} from "../packages/library/src";
import {
  createProject,
  deleteProjectMember,
  upsertProjectMember,
} from "../packages/projects/src";
import {
  admitRun,
  type ModelAuthorization,
  recoverRuns,
} from "../packages/runs/src";
import {
  type Attempt,
  assertRunAttempt,
  createRunRuntime,
  getRunExecutionModel,
  type RuntimeOptions,
  withRunAttempt,
  withRunEffect,
} from "../packages/runs/src/runtime";
import { runEffects, runs } from "../packages/runs/src/schema";
import {
  getSessionContext,
  getSessions,
  invalidateSessionSources,
  recordSessionSources,
} from "../packages/sessions/src";
import {
  openNativeStorage,
  readNativeMessages,
  saveNativeMessage,
} from "../packages/sessions/src/native";
import { sessions } from "../packages/sessions/src/schema";
import { DomainError, required } from "../packages/shared/src";
import { createSubscription } from "../packages/subscriptions/src";
import {
  authorizeSubscriptionModel,
  setSubscriptionApiKey,
} from "../packages/subscriptions/src/server";
import { archiveTask, createTask, getTask } from "../packages/tasks/src";
import { reviewTask, submitTaskReview } from "../packages/tasks/src/review";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members, users } from "../packages/workspaces/src/schema";
import { fixtureStorage } from "./fixtures/storage";
import { startPostgres } from "./postgres";

function model(
  onPrompt: (prompt: unknown) => unknown = () => {},
  tool = false,
  response = "Fixture response",
) {
  type StreamPart =
    Awaited<
      ReturnType<MastraLanguageModelV2Mock["doStream"]>
    >["stream"] extends ReadableStream<infer T>
      ? T
      : never;
  let calls = 0;
  return new MastraLanguageModelV2Mock({
    provider: "controlled-fixture",
    modelId: "fixture",
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: "text" as const, text: response }],
        finishReason: "stop" as const,
        usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
        warnings: [],
      };
    },
    async doStream(input: { prompt: unknown }) {
      await onPrompt(input.prompt);
      const useTool = tool && calls++ === 0;
      const chunks: StreamPart[] = useTool
        ? [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "native-call-1",
              toolName: "record_effect",
              input: "{}",
            },
            {
              type: "finish",
              finishReason: "tool-calls",
              usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
            },
          ]
        : [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: response },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
            },
          ];
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
      };
    },
  });
}

describe("direct native PostgreSQL execution", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
  let boss: PgBoss;
  let workspaceId: string;
  let subscriptionId: string;
  let connectionString: string;
  const authorization: ModelAuthorization = {
    authorizeModel: authorizeSubscriptionModel,
  };
  const key = randomBytes(32);
  const scope = <T>(fn: Parameters<typeof inWorkspace<T>>[3]) =>
    inWorkspace(database.db, workspaceId, { userId: "native-owner" }, fn);

  beforeAll(async () => {
    database = await startPostgres();
    connectionString = `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`;
    native = await openNativeStorage({ connectionString });
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    await database.db.insert(users).values({
      id: "native-owner",
      name: "Native fixture",
      email: "native-runtime@example.test",
      emailVerified: true,
    });
    workspaceId = (
      await claimInstallation(
        database.db,
        "native-owner",
        "Native runtime fixture",
      )
    ).id;
    subscriptionId = await scope(async (c) => {
      const account = await createSubscription(c, {
        title: "Fixture",
        provider: "openai",
        protocol: "responses",
        models: ["fixture"],
        visibility: "workspace",
      });
      await setSubscriptionApiKey(
        c,
        account.id,
        { apiKey: "fixture-not-a-real-key" },
        key,
      );
      return account.id;
    });
  });

  afterAll(async () => {
    await native?.close();
    await boss?.stop();
    await database?.stop();
  });

  async function setup(
    visibility: "workspace" | "participants" = "workspace",
    projectId?: string,
  ) {
    return scope(async (c) => {
      const agent = await createAgent(c, {
        title: "Worker",
        instructions: "Only authorized fixture work",
        model: "fixture",
        subscriptionId,
        visibility: "workspace",
      });
      await createEnvironment(c, agent.id);
      const chat = await createChat(c, {
        title: "Fixture discussion",
        projectId,
        visibility,
      });
      await createParticipant(c, chat.id, {
        agentId: agent.id,
        role: "contributor",
      });
      return { agentId: agent.id, chatId: chat.id };
    });
  }

  const admit = (
    selection: Awaited<ReturnType<typeof setup>>,
    body = "Remember the fixture",
    sessionId?: string,
  ) =>
    scope((c) =>
      admitRun(
        c,
        boss,
        {
          ...selection,
          body,
          sessionId,
          type: "prompt",
          requestId: crypto.randomUUID(),
        },
        authorization,
        native,
        snapshotRunDocuments,
      ),
    );
  const saved = async (id: string) =>
    required((await database.db.select().from(runs).where(eq(runs.id, id)))[0]);
  const auto = async (
    selection: Awaited<ReturnType<typeof setup>>,
    body: string,
    userId = "native-owner",
  ) => {
    const message = await createMessage(
      database.db,
      native,
      workspaceId,
      { userId },
      selection.chatId,
      {
        requestId: crypto.randomUUID(),
        body,
      },
    );
    const input = {
      ...selection,
      body,
      type: "prompt" as const,
      sessionMode: "auto" as const,
      messageIds: [message.id],
      requestId: crypto.randomUUID(),
    };
    const run = await inWorkspace(database.db, workspaceId, { userId }, (c) =>
      admitRun(c, boss, input, authorization, native, snapshotRunDocuments),
    );
    return { run, input, message };
  };
  const runtime = (input: Partial<RuntimeOptions> = {}) =>
    createRunRuntime(database.db, {
      storage: native,
      resolveModel: async () => model(),
      tools: () => ({}),
      authorizeSources: authorizeRunSources,
      publishOutput: async (attempt, output) => {
        const run = await saved(attempt.runId);
        await withRunAttempt(
          database.db,
          attempt,
          async () => {},
          undefined,
          native,
          authorizeRunSources,
          snapshotRunDocuments,
        );
        const [message] = await readNativeMessages(native, {
          workspaceId,
          threadId: required(run.sessionId ?? undefined),
          messageIds: [output.nativeMessageId],
        });
        expect(message?.role).toBe("assistant");
        expect(
          output.partIndexes.every(
            (index) => message?.content.parts[index]?.type === "text",
          ),
        ).toBe(true);
        await publishNativeMessage(
          database.db,
          native,
          workspaceId,
          { userId: run.sponsorId, agentId: run.agentId },
          run.chatId,
          {
            requestId: effectRequestId(run.id, output.nativeMessageId),
            sessionId: required(run.sessionId ?? undefined),
            ...output,
          },
          async (c) => {
            await assertRunAttempt(
              c,
              attempt,
              undefined,
              native,
              authorizeRunSources,
              snapshotRunDocuments,
            );
          },
        );
      },
      ...input,
      snapshotDocuments: snapshotRunDocuments,
    });

  it.each(["provider", "forbidden", "conflict"] as const)(
    "classifies a native %s error without confusing failure with cancellation",
    async (cause) => {
      const selection = await setup();
      const run = await admit(selection);
      let calls = 0;
      let publications = 0;
      const engine = runtime({
        resolveModel: async () =>
          model(() => {
            if (++calls === 2)
              throw cause === "provider"
                ? new Error("Controlled provider continuation failure")
                : new DomainError(cause, "Controlled authority failure");
          }, true),
        tools: () => ({
          record_effect: createTool({
            id: "record_effect",
            description: "Controlled read",
            inputSchema: z.object({}),
            execute: async () => ({ read: true }),
          }),
        }),
        publishOutput: async () => {
          publications++;
        },
      });
      try {
        await engine.dispatch(run.id);
        const result = await saved(run.id);
        expect(result.state).toBe(
          cause === "provider" ? "failed" : "interrupted",
        );
        expect(result.outcome).toBe(
          cause === "provider"
            ? "native_execution_failed"
            : "stopped_or_authorization_revoked",
        );
        expect(result.usage).toHaveLength(1);
        expect(calls).toBe(2);
        expect(publications).toBe(0);
        expect(engine.health().active).toBe(0);
      } finally {
        await engine.close();
      }
    },
  );

  it("keeps deadline cancellation interrupted when the model rejects after abort", async () => {
    const selection = await setup();
    const run = await admit(selection);
    let publications = 0;
    const engine = runtime({
      deadlineMs: 500,
      resolveModel: async (_attempt, signal) =>
        model(async () => {
          signal.throwIfAborted();
          await new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new Error("Controlled aborted stream")),
              { once: true },
            );
          });
        }),
      publishOutput: async () => {
        publications++;
      },
    });
    try {
      await engine.dispatch(run.id);
      const result = await saved(run.id);
      expect(result.state).toBe("interrupted");
      expect(result.outcome).toBe("stopped_or_authorization_revoked");
      expect(publications).toBe(0);
      expect(engine.health().active).toBe(0);
    } finally {
      await engine.close();
    }
  });

  it("uses a separate official schema and preserves native message identities after reopening", async () => {
    const schemas = await database.pool.query(
      "select schema_name from information_schema.schemata where schema_name in ('public','queue','mastra')",
    );
    expect(schemas.rows).toHaveLength(3);
    const input = {
      workspaceId,
      threadId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      role: "user" as const,
      body: "Persistent shared discussion",
      createdAt: new Date(),
    };
    await saveNativeMessage(native, input);
    await saveNativeMessage(native, input);
    await expect(
      saveNativeMessage(native, { ...input, body: "Conflicting retry" }),
    ).rejects.toThrow("identity changed");
    await native.close();
    native = await openNativeStorage({ connectionString });
    const messages = await readNativeMessages(native, {
      workspaceId,
      threadId: input.threadId,
      messageIds: [input.messageId],
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content.parts).toEqual([
      { type: "text", text: input.body },
    ]);
    await expect(
      readNativeMessages(native, {
        workspaceId: crypto.randomUUID(),
        threadId: input.threadId,
        messageIds: [input.messageId],
      }),
    ).rejects.toThrow();
    await expect(
      readNativeMessages(native, {
        workspaceId,
        threadId: input.threadId,
        messageIds: [crypto.randomUUID()],
      }),
    ).rejects.toThrow();
  });

  it("persists native model history and reuses only the accepted Session on a later Run", async () => {
    const selection = await setup();
    const first = await admit(selection);
    const prompts: unknown[] = [];
    const engine = runtime({
      resolveModel: async () => model((prompt) => prompts.push(prompt)),
    });
    await engine.dispatch(first.id);
    expect((await saved(first.id)).state).toBe("finished");
    const sessionId = required((await saved(first.id)).sessionId ?? undefined);
    const second = await admit(selection, "Continue the fixture", sessionId);
    await engine.dispatch(second.id);
    expect((await saved(second.id)).state).toBe("finished");
    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(prompts[1])).toContain("Fixture response");
    expect(JSON.stringify(prompts[1])).toContain("Continue the fixture");
    const different = await admit(selection, "Fresh private context");
    await engine.dispatch(different.id);
    expect(JSON.stringify(prompts[2])).not.toContain("Continue the fixture");
    await engine.close();
  });

  it("executes a native tool through a fenced durable receipt and rejects changed retries", async () => {
    const selection = await setup();
    const run = await admit(selection);
    let effects = 0;
    let observed: Attempt | undefined;
    const engine = runtime({
      resolveModel: async (attempt) => {
        observed = attempt;
        return model(undefined, true);
      },
      tools: (attempt) => ({
        record_effect: createTool({
          id: "record_effect",
          description: "Record one fixture effect",
          inputSchema: z.object({}).strict(),
          outputSchema: z.object({ count: z.number() }),
          execute: async (_input, context) => {
            expect(context.agent?.toolCallId).toBe("native-call-1");
            const call = {
              toolCallId: required(context.agent).toolCallId,
              toolName: "record_effect",
              input: {},
            };
            const effect = () =>
              withRunEffect(
                database.db,
                attempt,
                call,
                async () => ({ count: ++effects }),
                undefined,
                native,
                undefined,
                snapshotRunDocuments,
              );
            const results = await Promise.all([effect(), effect()]);
            expect(results).toEqual([{ count: 1 }, { count: 1 }]);
            await expect(
              withRunEffect(
                database.db,
                attempt,
                { ...call, input: { changed: true } },
                async () => ({ count: ++effects }),
                undefined,
                native,
                undefined,
                snapshotRunDocuments,
              ),
            ).rejects.toThrow("identity changed");
            return required(results[0]);
          },
        }),
      }),
    });
    await engine.dispatch(run.id);
    expect((await saved(run.id)).state).toBe("finished");
    expect(effects).toBe(1);
    expect(
      await database.db
        .select()
        .from(runEffects)
        .where(eq(runEffects.runId, run.id)),
    ).toHaveLength(1);
    await expect(
      getRunExecutionModel(
        database.db,
        required(observed),
        undefined,
        native,
        undefined,
        snapshotRunDocuments,
      ),
    ).rejects.toThrow("Inactive or stale");
    await engine.close();
  });

  it("serializes two runtime owners and honors durable stop before model launch", async () => {
    const selection = await setup();
    const first = await admit(selection);
    const second = await admit(selection);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let starts = 0;
    const owner = runtime({
      resolveModel: async () => {
        starts++;
        entered.resolve();
        await release.promise;
        return model();
      },
    });
    const contender = runtime();
    const working = owner.dispatch(first.id);
    await entered.promise;
    await contender.dispatch(first.id);
    await expect(contender.dispatch(second.id)).rejects.toThrow("busy");
    await recoverRuns(database.db, boss);
    expect((await saved(first.id)).state).toBe("running");
    const stopping = contender.stop(
      workspaceId,
      { userId: "native-owner" },
      first.id,
    );
    await stopping;
    release.resolve();
    await working;
    expect(starts).toBe(1);
    expect((await saved(first.id)).state).toBe("interrupted");
    await contender.dispatch(second.id);
    expect((await saved(second.id)).state).toBe("finished");
    await owner.close();
    await contender.close();
  });

  it("rejects a queued recipient removed from the Chat", async () => {
    const selection = await setup();
    const run = await admit(selection);
    const { participants } = await import("../packages/chats/src/schema");
    const participant = required(
      (
        await database.db
          .select()
          .from(participants)
          .where(eq(participants.agentId, selection.agentId))
      )[0],
    );
    await scope((c) => deleteParticipant(c, selection.chatId, participant.id));
    let started = false;
    const engine = runtime({
      resolveModel: async () => {
        started = true;
        return model();
      },
    });
    await engine.dispatch(run.id);
    expect(started).toBe(false);
    expect((await saved(run.id)).state).toBe("failed");
    expect((await saved(run.id)).outcome).toBe("authorization_revoked");
    await engine.close();
  });

  it("keeps private Session history sponsor-bound with the same bot and shared Chat", async () => {
    const selection = await setup();
    const original = await admit(selection);
    const sessionId = required(
      (await saved(original.id)).sessionId ?? undefined,
    );
    await database.db.insert(users).values({
      id: "native-other",
      name: "Other fixture",
      email: "native-other@example.test",
      emailVerified: true,
    });
    await database.db
      .insert(members)
      .values({ workspaceId, userId: "native-other", role: "contributor" });
    expect(
      (
        await inWorkspace(
          database.db,
          workspaceId,
          { userId: "native-other" },
          (c) =>
            getSessions(c, selection.chatId, { agentId: selection.agentId }),
        )
      ).items,
    ).toEqual([]);
    expect(
      (
        await scope((c) =>
          getSessions(c, selection.chatId, { agentId: selection.agentId }),
        )
      ).items.map((session) => session.id),
    ).toEqual([sessionId]);
    const input = {
      ...selection,
      body: "Do not inherit another human's private context",
      sessionId,
      type: "prompt" as const,
      requestId: crypto.randomUUID(),
    };
    await expect(
      inWorkspace(database.db, workspaceId, { userId: "native-other" }, (c) =>
        admitRun(c, boss, input, authorization, native, snapshotRunDocuments),
      ),
    ).rejects.toThrow("Fresh Session required");
    const fresh = await inWorkspace(
      database.db,
      workspaceId,
      { userId: "native-other" },
      (c) =>
        admitRun(
          c,
          boss,
          { ...input, sessionId: undefined, requestId: crypto.randomUUID() },
          authorization,
          native,
          snapshotRunDocuments,
        ),
    );
    expect((await saved(fresh.id)).sessionId).not.toBe(sessionId);
  });

  it("rechecks recipient revocation after asynchronous model resolution", async () => {
    const selection = await setup();
    const run = await admit(selection);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let providerCalls = 0;
    const engine = runtime({
      resolveModel: async () => {
        entered.resolve();
        await release.promise;
        return model(() => {
          providerCalls++;
        });
      },
    });
    const working = engine.dispatch(run.id);
    await entered.promise;
    const { participants } = await import("../packages/chats/src/schema");
    const participant = required(
      (
        await database.db
          .select()
          .from(participants)
          .where(eq(participants.agentId, selection.agentId))
      )[0],
    );
    await scope((c) => deleteParticipant(c, selection.chatId, participant.id));
    release.resolve();
    await working;
    expect(providerCalls).toBe(0);
    expect((await saved(run.id)).state).toBe("interrupted");
    await engine.close();
  });

  it("joins a cancelled native tool before releasing the Agent claim", async () => {
    const selection = await setup();
    const run = await admit(selection);
    const entered = Promise.withResolvers<void>();
    let cleaned = false;
    let published = false;
    const engine = runtime({
      resolveModel: async () => model(undefined, true),
      publishOutput: async () => {
        published = true;
      },
      tools: (_attempt, signal) => ({
        record_effect: createTool({
          id: "record_effect",
          description: "Cancelable fixture",
          inputSchema: z.object({}),
          outputSchema: z.object({ count: z.number() }),
          execute: async () => {
            entered.resolve();
            try {
              await new Promise<never>((_resolve, reject) => {
                signal.addEventListener(
                  "abort",
                  () => reject(new Error("Fixture stopped")),
                  { once: true },
                );
              });
            } finally {
              cleaned = true;
            }
          },
        }),
      }),
    });
    const working = engine.dispatch(run.id);
    await entered.promise;
    const result = await engine.stop(
      workspaceId,
      { userId: "native-owner" },
      run.id,
    );
    await working;
    expect(result.stopped).toBe(true);
    expect(cleaned).toBe(true);
    expect(published).toBe(false);
    expect((await saved(run.id)).state).toBe("interrupted");
    await engine.close();
  });

  it("fences queued credential replacement and never falls back to another account", async () => {
    const selection = await setup();
    const run = await admit(selection);
    await scope((c) =>
      setSubscriptionApiKey(
        c,
        subscriptionId,
        { apiKey: "replacement-fixture-not-real" },
        key,
      ),
    );
    let called = false;
    const engine = runtime({
      resolveModel: async () => {
        called = true;
        return model();
      },
    });
    await engine.dispatch(run.id);
    expect(called).toBe(false);
    expect((await saved(run.id)).state).toBe("failed");
    expect((await saved(run.id)).outcome).toBe("authorization_revoked");
    await engine.close();
  });

  it("delivers native attachment bytes and fences File audience revocation during a turn", async () => {
    const selection = await setup("participants");
    const other = crypto.randomUUID();
    await database.db.insert(users).values({
      id: other,
      name: "Attachment reader",
      email: `${other}@example.test`,
      emailVerified: true,
    });
    await database.db
      .insert(members)
      .values({ workspaceId, userId: other, role: "contributor" });
    const project = await scope(async (c) => {
      await createParticipant(c, selection.chatId, {
        userId: other,
        role: "contributor",
      });
      const project = await createProject(c, { title: "Attachment source" });
      await upsertProjectMember(c, project.id, other, "contributor");
      return project;
    });
    const objects = new Map<string, Uint8Array>();
    const storage = fixtureStorage({
      async put(key, bytes) {
        objects.set(key, bytes.slice());
      },
      async get(key) {
        return required(objects.get(key)).slice();
      },
    });
    const text = "Exact native attachment bytes: español 日本語";
    const file = await createFile(
      database.db,
      storage,
      workspaceId,
      { userId: "native-owner" },
      {
        requestId: crypto.randomUUID(),
        title: "source.txt",
        type: "text",
        visibility: "user",
        projectId: project.id,
        mediaType: "text/plain",
      },
      new TextEncoder().encode(text),
    );
    const message = await createMessage(
      database.db,
      native,
      workspaceId,
      { userId: "native-owner" },
      selection.chatId,
      {
        requestId: crypto.randomUUID(),
        body: "Read the selected attachment",
        fileIds: [file.id],
      },
    );
    const attachedRun = (sessionId?: string) =>
      scope((c) =>
        admitRun(
          c,
          boss,
          {
            ...selection,
            type: "prompt",
            requestId: crypto.randomUUID(),
            body: message.body,
            messageIds: [message.id],
            sessionId,
          },
          authorization,
          native,
          snapshotRunDocuments,
        ),
      );
    const prompts: unknown[] = [];
    const readAttachments: NonNullable<
      RuntimeOptions["readAttachments"]
    > = async (attempt) => {
      const actor = await withRunAttempt(
        database.db,
        attempt,
        async (c, run) => {
          expect(run.inputs.context?.messages[0]?.fileIds).toEqual([file.id]);
          return c.actor;
        },
        undefined,
        native,
        authorizeRunSources,
        snapshotRunDocuments,
      );
      const bytes = await readFile(
        database.db,
        storage,
        workspaceId,
        actor,
        file.id,
      );
      return [
        {
          data: `data:${file.mediaType};base64,${Buffer.from(bytes).toString("base64")}`,
          mediaType: file.mediaType,
          filename: file.title,
        },
      ];
    };
    const first = await attachedRun();
    const engine = runtime({
      readAttachments,
      resolveModel: async () => model((prompt) => prompts.push(prompt)),
    });
    await engine.dispatch(first.id);
    expect((await saved(first.id)).state).toBe("finished");
    expect(JSON.stringify(prompts)).toContain(text);
    expect(JSON.stringify(prompts)).not.toContain(
      Buffer.from(text).toString("base64"),
    );
    await engine.close();
    const second = await attachedRun(
      required((await saved(first.id)).sessionId ?? undefined),
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let published = 0;
    const revoked = runtime({
      readAttachments,
      resolveModel: async () =>
        model(async () => {
          entered.resolve();
          await release.promise;
        }),
      publishOutput: async () => {
        published++;
      },
    });
    const working = revoked.dispatch(second.id);
    await entered.promise;
    await scope((c) => deleteProjectMember(c, project.id, other));
    release.resolve();
    await working;
    expect((await saved(second.id)).state).toBe("interrupted");
    expect(published).toBe(0);
    await revoked.close();
  });

  it("automatically continues one private native history after storage and runtime restart", async () => {
    const selection = await setup("participants");
    const first = await auto(selection, "Remember restart sentinel alpha");
    expect(first.run.sessionState).toBeNull();
    expect((await saved(first.run.id)).sessionId).toBeNull();
    const engine = runtime();
    await engine.dispatch(first.run.id);
    const initial = await saved(first.run.id);
    expect(initial.state).toBe("finished");
    expect(initial.sessionState).toBe("new");
    await engine.close();
    await native.close();
    native = await openNativeStorage({ connectionString });
    const prompts: unknown[] = [];
    const restarted = runtime({
      resolveModel: async () => model((prompt) => prompts.push(prompt)),
    });
    const second = await auto(selection, "Recall the previous turn");
    await restarted.dispatch(second.run.id);
    const continued = await saved(second.run.id);
    expect(continued.state).toBe("finished");
    expect(continued.sessionState).toBe("continued");
    expect(continued.sessionId).toBe(initial.sessionId);
    expect(JSON.stringify(prompts)).toContain(
      "Remember restart sentinel alpha",
    );
    expect(
      JSON.stringify(prompts).split("Remember restart sentinel alpha"),
    ).toHaveLength(2);
    expect(JSON.stringify(prompts)).toContain("Fixture response");
    expect(JSON.stringify(prompts).split("Fixture response")).toHaveLength(2);
    const fresh = await admit(selection, "Explicit fresh turn");
    await restarted.dispatch(fresh.id);
    expect((await saved(fresh.id)).sessionId).not.toBe(initial.sessionId);
    expect((await saved(fresh.id)).sessionState).toBe("new");
    await restarted.close();
  });

  it("continues reviewed work in its existing auto Session and blocks an archived Task before queued launch", async () => {
    const project = await scope((c) =>
      createProject(c, { title: "Review continuity" }),
    );
    const selection = await setup("participants", project.id);
    const task = await scope((c) =>
      createTask(c, { projectId: project.id, title: "One ongoing task" }),
    );
    const first = await auto(selection, "Remember review sentinel");
    const engine = runtime();
    await engine.dispatch(first.run.id);
    const initial = await saved(first.run.id);
    const requestChanges = async () => {
      const submitted = await inWorkspace(
        database.db,
        workspaceId,
        { userId: "native-owner", agentId: selection.agentId },
        async (c) =>
          submitTaskReview(c, task.id, {
            editToken: (await getTask(c, task.id)).editToken,
            body: "Ready for review",
            chatId: selection.chatId,
          }),
      );
      const requestId = crypto.randomUUID();
      const changed = await scope((c) =>
        reviewTask(c, task.id, {
          requestId,
          editToken: submitted.task.editToken,
          decision: "request_changes",
          body: "Continue with the evidence",
        }),
      );
      const result = {
        taskId: task.id,
        requestId,
        commentId: changed.comment.id,
        editToken: changed.task.editToken,
      };
      const delivery = await continueTaskReview(
        {
          db: database.db,
          boss,
          nativeStorage: native,
          modelAuthorization: authorization,
        },
        workspaceId,
        "native-owner",
        result,
      );
      expect(delivery.status).toBe("sent");
      expect(
        (
          await continueTaskReview(
            {
              db: database.db,
              boss,
              nativeStorage: native,
              modelAuthorization: authorization,
            },
            workspaceId,
            "native-owner",
            result,
          )
        ).status,
      ).toBe("sent");
      const queued = await database.db
        .select()
        .from(runs)
        .where(eq(runs.taskId, task.id));
      return required(queued.find((run) => run.state === "queued"));
    };
    try {
      const second = await requestChanges();
      expect(second.inputs.sessionMode).toBe("auto");
      expect(second.inputs.taskReviewEditToken).toBe(
        (await scope((c) => getTask(c, task.id))).editToken,
      );
      await engine.dispatch(second.id);
      const continued = await saved(second.id);
      expect(continued.state).toBe("finished");
      expect(continued.sessionState).toBe("continued");
      expect(continued.sessionId).toBe(initial.sessionId);
      expect(
        await database.db.select().from(runs).where(eq(runs.taskId, task.id)),
      ).toHaveLength(1);
      const third = await requestChanges();
      await scope(async (c) =>
        archiveTask(c, task.id, true, (await getTask(c, task.id)).editToken),
      );
      await engine.dispatch(third.id);
      expect((await saved(third.id)).state).toBe("failed");
      expect((await saved(third.id)).outcome).toBe(
        "configuration_or_provider_unavailable",
      );
      expect((await saved(third.id)).attempt).toBe(0);
    } finally {
      await engine.close();
    }
  });

  it("permits only never-launched auto prompts to lack a persisted Session binding", async () => {
    const selection = await setup("participants");
    const automatic = await auto(selection, "Await dispatch-time binding");
    for (const state of [
      "launching",
      "running",
      "finished",
      "uncertain",
    ] as const) {
      await expect(
        database.db
          .update(runs)
          .set({ state })
          .where(eq(runs.id, automatic.run.id)),
      ).rejects.toThrow();
    }
    await expect(
      database.db
        .update(runs)
        .set({ attempt: 1 })
        .where(eq(runs.id, automatic.run.id)),
    ).rejects.toThrow();
    await database.db
      .update(runs)
      .set({ state: "interrupted" })
      .where(eq(runs.id, automatic.run.id));
    expect((await saved(automatic.run.id)).sessionId).toBeNull();
    const manual = await admit(selection);
    await expect(
      database.db
        .update(runs)
        .set({ sessionId: null })
        .where(eq(runs.id, manual.id)),
    ).rejects.toThrow();
  });

  it("orders queued auto turns by immutable admission cursor and excludes future public text", async () => {
    const selection = await setup("participants");
    const first = await auto(selection, "queue-first-body");
    const second = await auto(selection, "queue-second-body");
    const firstBefore = await saved(first.run.id);
    const secondBefore = await saved(second.run.id);
    expect(firstBefore.admittedCursor).toBeLessThan(
      secondBefore.admittedCursor,
    );
    const sameTime = new Date();
    await database.db
      .update(runs)
      .set({ createdAt: sameTime })
      .where(eq(runs.id, first.run.id));
    await database.db
      .update(runs)
      .set({ createdAt: sameTime })
      .where(eq(runs.id, second.run.id));
    const replay = await scope((c) =>
      admitRun(
        c,
        boss,
        first.input,
        authorization,
        native,
        snapshotRunDocuments,
      ),
    );
    expect(replay.id).toBe(first.run.id);
    await createMessage(
      database.db,
      native,
      workspaceId,
      { userId: "native-owner" },
      selection.chatId,
      { body: "future-public-sentinel", requestId: crypto.randomUUID() },
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const prompts: { id: string; prompt: unknown }[] = [];
    const engine = runtime({
      resolveModel: async (attempt) =>
        model(async (prompt) => {
          prompts.push({ id: attempt.runId, prompt });
          if (attempt.runId === first.run.id) {
            entered.resolve();
            await release.promise;
          }
        }),
    });
    await expect(engine.dispatch(second.run.id)).rejects.toThrow(
      "Earlier Run queued",
    );
    const working = engine.dispatch(first.run.id);
    await entered.promise;
    const contender = runtime();
    await expect(contender.dispatch(second.run.id)).rejects.toThrow("busy");
    release.resolve();
    await working;
    await engine.dispatch(second.run.id);
    const afterFirst = await saved(first.run.id);
    const afterSecond = await saved(second.run.id);
    expect(afterFirst.state).toBe("finished");
    expect(afterSecond.state).toBe("finished");
    expect(afterFirst.admittedCursor).toBe(firstBefore.admittedCursor);
    expect(afterSecond.sessionId).toBe(afterFirst.sessionId);
    expect(afterSecond.sessionState).toBe("continued");
    expect(
      JSON.stringify(prompts.filter((entry) => entry.id === first.run.id)),
    ).not.toContain("queue-second-body");
    expect(JSON.stringify(prompts)).not.toContain("future-public-sentinel");
    expect(
      secondBefore.inputs.publicMessages?.map(
        (message) => message.authorUserId,
      ),
    ).toEqual(["native-owner", "native-owner"]);
    await engine.dispatch(first.run.id);
    expect(prompts).toHaveLength(2);
    await engine.close();
    await contender.close();
  });

  it("isolates duplicate-named humans and separate Agents while preserving each exact auto family", async () => {
    const selection = await setup("participants");
    const other = crypto.randomUUID();
    await database.db.insert(users).values({
      id: other,
      name: "Native fixture",
      email: `${other}@example.test`,
      emailVerified: true,
    });
    await database.db
      .insert(members)
      .values({ workspaceId, userId: other, role: "contributor" });
    const secondAgent = await scope(async (c) => {
      await createParticipant(c, selection.chatId, {
        userId: other,
        role: "contributor",
      });
      const agent = await createAgent(c, {
        title: "Worker",
        instructions: "Fixture",
        model: "fixture",
        subscriptionId,
        visibility: "workspace",
      });
      await createEnvironment(c, agent.id);
      await createParticipant(c, selection.chatId, {
        agentId: agent.id,
        role: "contributor",
      });
      return { ...selection, agentId: agent.id };
    });
    const sentinel = `private-native-tool-${crypto.randomUUID()}`;
    const first = await auto(selection, "Public first message");
    const privateEngine = runtime({
      resolveModel: async () => model(undefined, true),
      tools: () => ({
        record_effect: createTool({
          id: "record_effect",
          description: "Controlled private tool result",
          inputSchema: z.object({}),
          execute: async () => ({ diagnostic: sentinel }),
        }),
      }),
    });
    await privateEngine.dispatch(first.run.id);
    expect((await saved(first.run.id)).state).toBe("finished");
    await privateEngine.close();
    const prompts: unknown[] = [];
    const engine = runtime({
      resolveModel: async (attempt) =>
        model(
          (prompt) => prompts.push(prompt),
          false,
          attempt.agentId === secondAgent.agentId
            ? "agent-two-public-output"
            : (await saved(attempt.runId)).sponsorId === other
              ? "human-two-public-output"
              : "owner-followup-output",
        ),
    });
    const humanTwo = await auto(
      selection,
      "I am native-owner; @Worker recall my private history",
      other,
    );
    await engine.dispatch(humanTwo.run.id);
    expect(JSON.stringify(prompts.at(-1))).toContain("Fixture response");
    const agentTwo = await auto(secondAgent, "Agent two's first turn");
    await engine.dispatch(agentTwo.run.id);
    expect(JSON.stringify(prompts)).not.toContain(sentinel);
    expect((await saved(humanTwo.run.id)).sponsorId).toBe(other);
    expect((await saved(humanTwo.run.id)).sessionId).not.toBe(
      (await saved(first.run.id)).sessionId,
    );
    expect((await saved(agentTwo.run.id)).sessionId).not.toBe(
      (await saved(first.run.id)).sessionId,
    );
    const returnToFirst = await auto(
      selection,
      "Return to my exact private family",
    );
    await engine.dispatch(returnToFirst.run.id);
    expect((await saved(returnToFirst.run.id)).sessionId).toBe(
      (await saved(first.run.id)).sessionId,
    );
    expect(JSON.stringify(prompts.at(-1))).toContain(sentinel);
    expect(JSON.stringify(prompts.at(-1))).toContain(other);
    expect(JSON.stringify(prompts.at(-1))).toContain("human-two-public-output");
    expect(JSON.stringify(prompts.at(-1))).toContain("agent-two-public-output");
    expect(
      JSON.stringify(prompts.at(-1)).split("Fixture response"),
    ).toHaveLength(2);
    const later = await auto(
      selection,
      "Do not replay public reference material already in native history",
    );
    await engine.dispatch(later.run.id);
    expect((await saved(later.run.id)).state).toBe("finished");
    expect(
      JSON.stringify(prompts.at(-1)).split("human-two-public-output"),
    ).toHaveLength(2);
    expect(
      JSON.stringify(prompts.at(-1)).split("agent-two-public-output"),
    ).toHaveLength(2);
    expect(
      JSON.stringify(prompts.at(-1)).split("owner-followup-output"),
    ).toHaveLength(2);
    await engine.close();
  });

  it("resets revoked dynamic sources before model binding and never resurrects an older Session", async () => {
    const selection = await setup("participants");
    const document = await scope((c) =>
      createDocument(c, {
        title: "Dynamic source",
        body: "dynamic-private-sentinel",
        visibility: "workspace",
      }),
    );
    const first = await auto(selection, "Read the dynamic source");
    const engine = runtime({
      resolveModel: async () => model(undefined, true),
      tools: (attempt) => ({
        record_effect: createTool({
          id: "record_effect",
          description: "Read authorized Document",
          inputSchema: z.object({}),
          execute: async () =>
            withRunAttempt(
              database.db,
              attempt,
              async (c, run) => {
                const value = await getDocument(c, document.id);
                await recordSessionSources(
                  c,
                  required(run.sessionId ?? undefined),
                  [{ type: "document", id: value.id }],
                );
                return { body: value.body };
              },
              undefined,
              native,
              authorizeRunSources,
              snapshotRunDocuments,
            ),
        }),
      }),
    });
    await engine.dispatch(first.run.id);
    const initial = await saved(first.run.id);
    expect(initial.state).toBe("finished");
    await engine.close();
    await scope((c) =>
      updateDocument(c, document.id, {
        visibility: "user",
        editToken: document.editToken,
      }),
    );
    const prompts: unknown[] = [];
    const nextEngine = runtime({
      resolveModel: async () => model((prompt) => prompts.push(prompt)),
    });
    const second = await auto(selection, "Continue after revocation");
    await nextEngine.dispatch(second.run.id);
    const reset = await saved(second.run.id);
    expect(reset.state).toBe("finished");
    expect(reset.sessionState).toBe("reset");
    expect(reset.sessionId).not.toBe(initial.sessionId);
    expect(JSON.stringify(prompts)).not.toContain("dynamic-private-sentinel");
    await scope(async (c) => {
      const current = await getDocument(c, document.id);
      await updateDocument(c, document.id, {
        visibility: "workspace",
        editToken: current.editToken,
      });
    });
    await inWorkspace(
      database.db,
      workspaceId,
      { userId: "native-owner", agentId: selection.agentId },
      (c) =>
        invalidateSessionSources(c, required(reset.sessionId ?? undefined)),
    );
    const third = await auto(
      selection,
      "Do not resurrect the old compatible Session",
    );
    await nextEngine.dispatch(third.run.id);
    const last = await saved(third.run.id);
    expect(last.state).toBe("finished");
    expect(last.sessionState).toBe("reset");
    expect(last.sessionId).not.toBe(initial.sessionId);
    expect(last.sessionId).not.toBe(reset.sessionId);
    expect(JSON.stringify(prompts)).not.toContain("dynamic-private-sentinel");
    await nextEngine.close();
  });

  it("reauthorizes dynamic source memory before the next native model step", async () => {
    const selection = await setup("participants");
    const document = await scope((c) =>
      createDocument(c, {
        title: "Step source",
        body: "step-private-sentinel",
        visibility: "workspace",
      }),
    );
    const first = await auto(
      selection,
      "Read then revoke before the next step",
    );
    let modelCalls = 0;
    let published = 0;
    const engine = runtime({
      resolveModel: async () =>
        model(() => {
          modelCalls++;
        }, true),
      publishOutput: async () => {
        published++;
      },
      tools: (attempt) => ({
        record_effect: createTool({
          id: "record_effect",
          description: "Read and revoke fixture",
          inputSchema: z.object({}),
          execute: async () => {
            const result = await withRunAttempt(
              database.db,
              attempt,
              async (c, run) => {
                const value = await getDocument(c, document.id);
                await recordSessionSources(
                  c,
                  required(run.sessionId ?? undefined),
                  [{ type: "document", id: value.id }],
                );
                return { body: value.body };
              },
              undefined,
              native,
              authorizeRunSources,
              snapshotRunDocuments,
            );
            await scope((c) =>
              updateDocument(c, document.id, {
                visibility: "user",
                editToken: document.editToken,
              }),
            );
            return result;
          },
        }),
      }),
    });
    await engine.dispatch(first.run.id);
    expect(modelCalls).toBe(1);
    expect(published).toBe(0);
    expect((await saved(first.run.id)).state).not.toBe("finished");
    await engine.close();
  });

  it("retains explicitly selected private Document content without granting ordinary Agent reads", async () => {
    const selection = await setup("participants");
    const document = await scope((c) =>
      createDocument(c, {
        title: "Explicit private selection",
        body: "selected-private-document",
        visibility: "user",
      }),
    );
    const run = await scope((c) =>
      admitRun(
        c,
        boss,
        {
          ...selection,
          body: "Read my selected Document",
          documentIds: [document.id],
          type: "prompt",
          requestId: crypto.randomUUID(),
        },
        authorization,
        native,
        snapshotRunDocuments,
      ),
    );
    const prompts: unknown[] = [];
    const engine = runtime({
      resolveModel: async () => model((prompt) => prompts.push(prompt)),
    });
    await engine.dispatch(run.id);
    expect((await saved(run.id)).state).toBe("finished");
    expect(JSON.stringify(prompts)).toContain("selected-private-document");
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: "native-owner", agentId: selection.agentId },
        (c) => getDocument(c, document.id),
      ),
    ).rejects.toThrow();
    await engine.close();
  });

  it("rejects source-ledger overflow transactionally without certifying truncated memory", async () => {
    const selection = await setup("participants");
    const run = await admit(selection);
    const id = required((await saved(run.id)).sessionId ?? undefined);
    const agentScope = <T>(fn: Parameters<typeof inWorkspace<T>>[3]) =>
      inWorkspace(
        database.db,
        workspaceId,
        { userId: "native-owner", agentId: selection.agentId },
        fn,
      );
    await expect(
      agentScope((c) =>
        recordSessionSources(
          c,
          id,
          Array.from({ length: 201 }, () => ({
            type: "document" as const,
            id: crypto.randomUUID(),
          })),
        ),
      ),
    ).rejects.toThrow("Retained source limit");
    expect((await scope((c) => getSessionContext(c, id))).sources).toEqual([]);
    await expect(
      agentScope((c) =>
        recordSessionSources(c, id, [
          {
            type: "skill-file",
            skillId: crypto.randomUUID(),
            fileId: crypto.randomUUID(),
            path: "x".repeat(65536),
            sha256: "a".repeat(64),
            byteLength: 1,
          },
        ]),
      ),
    ).rejects.toThrow("Retained source limit");
    expect((await scope((c) => getSessionContext(c, id))).sources).toEqual([]);
    const bounded = Array.from({ length: 200 }, () => ({
      type: "document" as const,
      id: crypto.randomUUID(),
    }));
    await agentScope((c) => recordSessionSources(c, id, bounded));
    await agentScope((c) => recordSessionSources(c, id, bounded));
    await expect(
      agentScope((c) =>
        recordSessionSources(c, id, [
          { type: "document", id: crypto.randomUUID() },
        ]),
      ),
    ).rejects.toThrow("Retained source limit");
    expect((await scope((c) => getSessionContext(c, id))).sources).toEqual(
      bounded,
    );
    await database.db
      .update(sessions)
      .set({ sourcesCertified: false })
      .where(eq(sessions.id, id));
    expect(
      (await scope((c) => getSessionContext(c, id))).sourcesCertified,
    ).toBe(false);
  });

  it("rejects foreign triggers and automatic/manual selection mixing", async () => {
    const selection = await setup("participants");
    const first = await auto(selection, "Strict initiating message");
    for (const extra of [
      { sessionId: crypto.randomUUID() },
      { taskId: crypto.randomUUID() },
      { documentIds: [crypto.randomUUID()] },
      { messageIds: [] },
      { messageIds: [first.message.id, first.message.id] },
    ]) {
      await expect(
        scope((c) =>
          admitRun(
            c,
            boss,
            { ...first.input, ...extra, requestId: crypto.randomUUID() },
            authorization,
            native,
            snapshotRunDocuments,
          ),
        ),
      ).rejects.toThrow();
    }
    await expect(
      scope((c) =>
        admitRun(
          c,
          boss,
          {
            ...first.input,
            body: "Spoofed initiating body",
            requestId: crypto.randomUUID(),
          },
          authorization,
          native,
          snapshotRunDocuments,
        ),
      ),
    ).rejects.toThrow();
    const otherChat = await setup("participants");
    await expect(
      scope((c) =>
        admitRun(
          c,
          boss,
          { ...first.input, ...otherChat, requestId: crypto.randomUUID() },
          authorization,
          native,
          snapshotRunDocuments,
        ),
      ),
    ).rejects.toThrow();
    const other = crypto.randomUUID();
    await database.db.insert(users).values({
      id: other,
      name: "Native fixture",
      email: `${other}@example.test`,
      emailVerified: true,
    });
    await database.db
      .insert(members)
      .values({ workspaceId, userId: other, role: "contributor" });
    await scope((c) =>
      createParticipant(c, selection.chatId, {
        userId: other,
        role: "contributor",
      }),
    );
    const foreign = await createMessage(
      database.db,
      native,
      workspaceId,
      { userId: other },
      selection.chatId,
      { requestId: crypto.randomUUID(), body: "Foreign human trigger" },
    );
    await expect(
      scope((c) =>
        admitRun(
          c,
          boss,
          {
            ...first.input,
            body: foreign.body,
            messageIds: [foreign.id],
            requestId: crypto.randomUUID(),
          },
          authorization,
          native,
          snapshotRunDocuments,
        ),
      ),
    ).rejects.toThrow("Initiating message");
  });

  it("resets automatic history when the accepted provider credential identity changes", async () => {
    const selection = await setup("participants");
    const first = await auto(selection, "Before credential replacement");
    const engine = runtime();
    await engine.dispatch(first.run.id);
    const initial = await saved(first.run.id);
    expect(initial.state).toBe("finished");
    await scope((c) =>
      setSubscriptionApiKey(
        c,
        subscriptionId,
        { apiKey: "rotated-fixture-not-a-real-key" },
        key,
      ),
    );
    const second = await auto(selection, "After credential replacement");
    await engine.dispatch(second.run.id);
    const reset = await saved(second.run.id);
    expect(reset.state).toBe("finished");
    expect(reset.inputs.accountId).not.toBe(initial.inputs.accountId);
    expect(reset.sessionId).not.toBe(initial.sessionId);
    expect(reset.sessionState).toBe("reset");
    await engine.close();
  });

  it("does not turn public bot messages, incidental mentions or completion retries into auto Runs", async () => {
    const selection = await setup("participants");
    const first = await auto(selection, "Only one explicitly admitted Run");
    const engine = runtime();
    await engine.dispatch(first.run.id);
    const bot = await createMessage(
      database.db,
      native,
      workspaceId,
      { userId: "native-owner", agentId: selection.agentId },
      selection.chatId,
      { body: "@Worker incidental mention", requestId: crypto.randomUUID() },
    );
    await expect(
      scope((c) =>
        admitRun(
          c,
          boss,
          {
            ...first.input,
            body: bot.body,
            messageIds: [bot.id],
            requestId: crypto.randomUUID(),
          },
          authorization,
          native,
          snapshotRunDocuments,
        ),
      ),
    ).rejects.toThrow("Initiating message");
    await engine.dispatch(first.run.id);
    expect(
      await database.db
        .select({ id: runs.id })
        .from(runs)
        .where(eq(runs.chatId, selection.chatId)),
    ).toEqual([{ id: first.run.id }]);
    await engine.close();
  });

  it("retains an uncertain claim when a native tool cannot confirm cancellation", async () => {
    const selection = await setup();
    const run = await admit(selection);
    const next = await admit(selection);
    const automatic = await auto(
      selection,
      "Automatic successor must also wait for confirmed cleanup",
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const toolEnded = Promise.withResolvers<void>();
    let effect = false;
    const engine = runtime({
      resolveModel: async () => model(undefined, true),
      tools: (attempt) => ({
        record_effect: createTool({
          id: "record_effect",
          description: "Unconfirmed cancellation fixture",
          inputSchema: z.object({}),
          execute: async () => {
            entered.resolve();
            await release.promise;
            try {
              return await withRunEffect(
                database.db,
                attempt,
                { toolCallId: "late-call", toolName: "late-effect", input: {} },
                async () => {
                  effect = true;
                  return { saved: true };
                },
                undefined,
                native,
                undefined,
                snapshotRunDocuments,
              );
            } finally {
              toolEnded.resolve();
            }
          },
        }),
      }),
    });
    const working = engine.dispatch(run.id);
    await entered.promise;
    const result = await engine.stop(
      workspaceId,
      { userId: "native-owner" },
      run.id,
    );
    expect(result.stopped).toBe(false);
    expect((await saved(run.id)).state).toBe("uncertain");
    const contender = runtime();
    await expect(contender.dispatch(next.id)).rejects.toThrow("busy");
    await expect(contender.dispatch(automatic.run.id)).rejects.toThrow("busy");
    release.resolve();
    await toolEnded.promise;
    await working;
    expect(effect).toBe(false);
    await engine.close();
    await contender.close();
  });
});
