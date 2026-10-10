import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import { createTool } from "@mastra/core/tools";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import { createChat, createParticipant } from "../packages/chats/src";
import { createEnvironment } from "../packages/environments/src";
import { snapshotRunDocuments } from "../packages/library/src";
import { admitRun, getRunUsage } from "../packages/runs/src";
import {
  createRunRuntime,
  type RuntimeOptions,
  withRunAttempt,
} from "../packages/runs/src/runtime";
import { runs } from "../packages/runs/src/schema";
import {
  openNativeStorage,
  readNativeMessages,
} from "../packages/sessions/src/native";
import { required } from "../packages/shared/src";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { users } from "../packages/workspaces/src/schema";
import {
  controlledModel,
  controlledSubscription,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { startPostgres } from "./postgres";

type Chunk =
  Awaited<
    ReturnType<MastraLanguageModelV2Mock["doStream"]>
  >["stream"] extends ReadableStream<infer T>
    ? T
    : never;

function streamModel(chunks: Chunk[]) {
  return new MastraLanguageModelV2Mock({
    provider: "controlled-native-fixture",
    modelId: "fixture",
    supportedUrls: {},
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    }),
  });
}

describe("native deterministic stream settlement, privacy and bounded output", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
  let boss: PgBoss;
  let workspaceId: string;
  let subscriptionId: string;
  const engines: ReturnType<typeof createRunRuntime>[] = [];
  const published: string[] = [];
  const scope = <T>(work: Parameters<typeof inWorkspace<T>>[3]) =>
    inWorkspace(
      database.db,
      workspaceId,
      { userId: "native-stream-owner" },
      work,
    );
  const saved = async (id: string) =>
    required((await database.db.select().from(runs).where(eq(runs.id, id)))[0]);

  beforeAll(async () => {
    database = await startPostgres();
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    boss = await startQueue(database.db, database.pool, {
      install: true,
      workers: false,
    });
    await database.db.insert(users).values({
      id: "native-stream-owner",
      name: "Native stream fixture",
      email: "native-stream@example.test",
      emailVerified: true,
    });
    workspaceId = (
      await claimInstallation(
        database.db,
        "native-stream-owner",
        "Native stream fixture",
      )
    ).id;
    subscriptionId = await scope(controlledSubscription);
  });
  afterEach(async () => {
    await Promise.all(engines.splice(0).map((engine) => engine.close()));
    published.length = 0;
  });
  afterAll(async () => {
    await native?.close();
    await boss?.stop();
    await database?.stop();
  });

  async function admit() {
    return scope(async (c) => {
      const agent = await createAgent(c, {
        title: "Native stream fixture",
        instructions: "Deterministic fixture only",
        model: "fixture",
        subscriptionId,
        visibility: "workspace",
      });
      await createEnvironment(c, agent.id);
      const chat = await createChat(c, {
        title: "Native stream output",
        visibility: "workspace",
      });
      await createParticipant(c, chat.id, {
        agentId: agent.id,
        role: "contributor",
      });
      return admitRun(
        c,
        boss,
        {
          agentId: agent.id,
          chatId: chat.id,
          requestId: crypto.randomUUID(),
          type: "prompt",
          body: "Stream fixture",
        },
        nativeModelAuthorization,
        native,
        snapshotRunDocuments,
      );
    });
  }
  function engine(options: Partial<RuntimeOptions> = {}) {
    const value = createRunRuntime(database.db, {
      storage: native,
      resolveModel: async () => controlledModel(),
      tools: () => ({}),
      publishOutput: async (attempt, output) => {
        const run = await saved(attempt.runId);
        await withRunAttempt(
          database.db,
          attempt,
          async () => {},
          undefined,
          native,
          undefined,
          snapshotRunDocuments,
        );
        const [message] = await readNativeMessages(native, {
          workspaceId,
          threadId: required(run.sessionId ?? undefined),
          messageIds: [output.nativeMessageId],
        });
        for (const index of output.partIndexes) {
          const part = message?.content.parts[index];
          expect(part?.type).toBe("text");
          if (part?.type === "text") published.push(part.text);
        }
      },
      ...options,
      snapshotDocuments: snapshotRunDocuments,
    });
    engines.push(value);
    return value;
  }

  it("orders native text, persists private reasoning without publishing it, and captures usage once", async () => {
    const run = await admit();
    const model = streamModel([
      { type: "stream-start", warnings: [] },
      { type: "reasoning-start", id: "thought" },
      { type: "reasoning-delta", id: "thought", delta: "PRIVATE THOUGHT" },
      { type: "reasoning-end", id: "thought" },
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: "First " },
      { type: "text-delta", id: "text", delta: "second" },
      { type: "text-end", id: "text" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      },
    ]);
    const runtime = engine({ resolveModel: async () => model });
    await runtime.dispatch(run.id);
    expect((await saved(run.id)).state).toBe("finished");
    expect(published.join("")).toBe("First second");
    expect(published.join("")).not.toContain("PRIVATE THOUGHT");
    const before = await saved(run.id);
    expect(before.usage).toHaveLength(1);
    await runtime.dispatch(run.id);
    expect((await saved(run.id)).usage).toEqual(before.usage);
    expect(published.join("")).toBe("First second");
    const memory = await native.storage.getStore("memory");
    const transcript = await required(memory).listMessages({
      threadId: required(before.sessionId ?? undefined),
      resourceId: workspaceId,
      perPage: 100,
    });
    expect(JSON.stringify(transcript)).toContain("PRIVATE THOUGHT");
  });

  it("leaves cost unknown when native usage does not report cache counts", async () => {
    const run = await admit();
    await engine().dispatch(run.id);
    expect((await saved(run.id)).usage).toEqual([
      expect.objectContaining({
        tokens: {
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
          cacheReadTokens: null,
          cacheWriteTokens: null,
        },
      }),
    ]);
    expect(await scope((c) => getRunUsage(c, run.id))).toMatchObject({
      estimatedCost: null,
      inputTokens: 10,
      outputTokens: 2,
    });
  });

  it("bounds oversized native text before any publication", async () => {
    const run = await admit();
    await engine({
      resolveModel: async () => controlledModel({ text: "x".repeat(1048577) }),
    }).dispatch(run.id);
    expect((await saved(run.id)).state).not.toBe("finished");
    expect(published).toEqual([]);
  });

  it.each(["error", "length"] as const)(
    "does not report a native %s finish as successful completion",
    async (finishReason) => {
      const run = await admit();
      const model = streamModel([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "incomplete" },
        {
          type: "text-delta",
          id: "incomplete",
          delta: "Incomplete native result",
        },
        { type: "text-end", id: "incomplete" },
        {
          type: "finish",
          finishReason,
          usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        },
      ]);
      await engine({ resolveModel: async () => model }).dispatch(run.id);
      expect((await saved(run.id)).state).not.toBe("finished");
      expect(published).toEqual([]);
    },
  );

  it("retains uncertain model I/O when a resolver ignores cancellation and recovery cannot confirm it stopped", async () => {
    const run = await admit();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const runtime = engine({
      resolveModel: async () => {
        entered.resolve();
        await release.promise;
        return controlledModel();
      },
    });
    const work = runtime.dispatch(run.id);
    const fresh = engine();
    try {
      await entered.promise;
      await runtime.stop(
        workspaceId,
        { userId: "native-stream-owner" },
        run.id,
      );
      expect((await saved(run.id)).state).toBe("uncertain");
      await fresh.reconcile(run.id);
      expect((await saved(run.id)).state).toBe("uncertain");
      expect(published).toEqual([]);
    } finally {
      release.resolve();
      await work;
    }
  });

  it("executes accepted native tools serially and waits for tool completion before publication", async () => {
    const run = await admit();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const calls: number[] = [];
    const runtime = engine({
      resolveModel: async () =>
        controlledModel({
          toolRequests: [
            { toolName: "serial_effect", input: { order: 1 } },
            { toolName: "serial_effect", input: { order: 2 } },
          ],
        }),
      tools: () => ({
        serial_effect: createTool({
          id: "serial_effect",
          description: "Deterministic serialized tool fixture",
          inputSchema: z.object({ order: z.number() }),
          execute: async ({ order }) => {
            calls.push(order);
            if (order === 1) {
              entered.resolve();
              await release.promise;
            }
            return { order };
          },
        }),
      }),
    });
    const work = runtime.dispatch(run.id);
    try {
      await entered.promise;
      expect(calls).toEqual([1]);
      expect(published).toEqual([]);
      expect((await saved(run.id)).state).toBe("running");
    } finally {
      release.resolve();
      await work;
    }
    expect(calls).toEqual([1, 2]);
    expect((await saved(run.id)).state).toBe("finished");
    expect(published.length).toBeGreaterThan(0);
  });

  it("composes deadline cancellation with the actual native model stream", async () => {
    const run = await admit();
    let signal: AbortSignal | undefined;
    const runtime = engine({
      deadlineMs: 200,
      resolveModel: async (_attempt, current) => {
        signal = current;
        return controlledModel({ hold: true, signal: current });
      },
    });
    await runtime.dispatch(run.id);
    expect(signal?.aborted).toBe(true);
    expect((await saved(run.id)).state).toBe("interrupted");
    expect(published).toEqual([]);
    expect(runtime.health().active).toBe(0);
    await runtime.close();
    await runtime.close();
  });
});
