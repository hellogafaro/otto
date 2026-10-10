import { createHash } from "node:crypto";
import { Agent, type ToolsInput } from "@mastra/core/agent";
import { AgentController, type Session } from "@mastra/core/agent-controller";
import type { MastraModelConfig } from "@mastra/core/llm";
import {
  MASTRA_MESSAGE_AUTHOR_KEY,
  RequestContext,
} from "@mastra/core/request-context";
import { getAgent } from "@otto/agents";
import { getChat, getChatSessionMessageIds } from "@otto/chats";
import type { Database } from "@otto/db";
import { getEnvironment } from "@otto/environments";
import {
  bindSessionContext,
  createSession,
  getLatestAutoSession,
  getSessionContext,
  recordSessionSources,
  requireSession,
  type SessionSource,
} from "@otto/sessions";
import {
  type NativeSessionStorage,
  readNativeMessages,
} from "@otto/sessions/native";
import { DomainError, required } from "@otto/shared";
import {
  type Actor,
  advanceCursor,
  type Context,
  inWorkspace,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  failQueuedRun,
  getRun,
  type SnapshotDocuments,
  validateRunSources,
} from "./index";
import { runEffects, runs, type UsageTokens } from "./schema";

export interface Attempt {
  runId: string;
  agentId: string;
  attempt: number;
  launchKey: string;
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

type ValidateSchedule = (
  c: Context,
  id: string,
  editToken: number,
) => Promise<void>;

export type AuthorizeSources = (
  c: Context,
  run: typeof runs.$inferSelect,
  sources?: SessionSource[],
) => Promise<void>;

async function within<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new DomainError("unavailable", "Native cleanup deadline")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface RuntimeOptions {
  storage: NativeSessionStorage;
  resolveModel(
    attempt: Attempt,
    signal: AbortSignal,
  ): Promise<MastraModelConfig>;
  tools(attempt: Attempt, signal: AbortSignal): ToolsInput;
  cleanup?(attempt: Attempt): Promise<void>;
  readAttachments?(
    attempt: Attempt,
    signal: AbortSignal,
  ): Promise<{ data: string; mediaType: string; filename?: string }[]>;
  publishOutput?(
    attempt: Attempt,
    output: { nativeMessageId: string; partIndexes: number[] },
  ): Promise<void>;
  validateSchedule?: ValidateSchedule;
  authorizeSources?: AuthorizeSources;
  snapshotDocuments?: SnapshotDocuments;
  deadlineMs?: number;
}

export interface Usage extends UsageTokens {
  sequence: number;
  provider: string;
  model: string;
}

export interface NativeDraft {
  id: string;
  runId: string;
  agentId: string;
  text: string;
}

export async function withRunAttempt<T>(
  db: Database,
  identity: Attempt,
  action: (c: Context, run: typeof runs.$inferSelect) => Promise<T>,
  validateSchedule?: ValidateSchedule,
  native?: NativeSessionStorage,
  authorizeSources?: AuthorizeSources,
  snapshotDocuments?: SnapshotDocuments,
) {
  const descriptor = required(
    (await db.select().from(runs).where(eq(runs.id, identity.runId)))[0],
  );
  return inWorkspace(
    db,
    descriptor.workspaceId,
    { userId: descriptor.sponsorId, agentId: identity.agentId },
    async (c) => {
      const run = await assertRunAttempt(
        c,
        identity,
        validateSchedule,
        native,
        authorizeSources,
        snapshotDocuments,
      );
      return action(c, run);
    },
  );
}

export async function assertRunAttempt(
  c: Context,
  identity: Attempt,
  validateSchedule?: ValidateSchedule,
  native?: NativeSessionStorage,
  authorizeSources?: AuthorizeSources,
  snapshotDocuments?: SnapshotDocuments,
) {
  const run = required(
    (await c.tx.select().from(runs).where(eq(runs.id, identity.runId)))[0],
  );
  if (
    run.workspaceId !== c.workspaceId ||
    run.sponsorId !== c.actor.userId ||
    run.agentId !== identity.agentId ||
    (c.actor.agentId !== undefined && c.actor.agentId !== identity.agentId) ||
    run.attempt !== identity.attempt ||
    run.launchKey !== identity.launchKey ||
    run.state !== "running" ||
    run.stopRequested ||
    !run.deadlineAt ||
    run.deadlineAt.getTime() <= Date.now()
  )
    throw new DomainError("forbidden", "Inactive or stale Run identity");
  await validateRunSources(
    { ...c, actor: { userId: run.sponsorId } },
    run,
    validateSchedule,
    "continue",
    native,
    snapshotDocuments,
  );
  const session =
    run.type === "prompt" || run.sessionId
      ? await getSessionContext(c, required(run.sessionId ?? undefined))
      : undefined;
  if (
    session &&
    (session.ownerId !== run.sponsorId ||
      session.agentId !== run.agentId ||
      session.chatId !== run.chatId ||
      session.accountId !== run.inputs.accountId ||
      (run.inputs.sessionScope && session.scope !== run.inputs.sessionScope))
  )
    throw new DomainError("forbidden", "Native Session binding changed");
  if (
    ((session?.sources.length ?? 0) > 0 ||
      run.inputs.context?.messages.some(
        (message) => message.fileIds?.length,
      )) &&
    !authorizeSources
  )
    throw new DomainError(
      "unavailable",
      "Native attachment authorization is not configured",
    );
  await authorizeSources?.(
    { ...c, actor: { userId: run.sponsorId, agentId: run.agentId } },
    run,
    session?.sources ?? [],
  );
  const environment = await getEnvironment(c, run.agentId);
  if (environment.generation !== run.environmentGeneration)
    throw new DomainError("forbidden", "Execution generation changed");
  return run;
}

export async function getRunExecutionModel(
  db: Database,
  attempt: Attempt,
  validateSchedule?: ValidateSchedule,
  native?: NativeSessionStorage,
  authorizeSources?: AuthorizeSources,
  snapshotDocuments?: SnapshotDocuments,
) {
  return withRunAttempt(
    db,
    attempt,
    async (_c, run) => ({
      workspaceId: run.workspaceId,
      sponsorId: run.sponsorId,
      subscriptionId: required(
        run.inputs.subscriptionId ?? undefined,
        "unavailable",
      ),
      accountId: required(run.inputs.accountId ?? undefined, "unavailable"),
      model: run.inputs.model,
      modelConfig: required(run.inputs.modelConfig ?? undefined, "unavailable"),
    }),
    validateSchedule,
    native,
    authorizeSources,
    snapshotDocuments,
  );
}

export async function withRunEffect<T>(
  db: Database,
  attempt: Attempt,
  input: { toolCallId: string; toolName: string; input: unknown },
  action: (c: Context, run: typeof runs.$inferSelect) => Promise<T>,
  validateSchedule?: ValidateSchedule,
  native?: NativeSessionStorage,
  authorizeSources?: AuthorizeSources,
  snapshotDocuments?: SnapshotDocuments,
): Promise<T> {
  if (
    !input.toolCallId ||
    input.toolCallId.length > 200 ||
    !input.toolName ||
    input.toolName.length > 200
  )
    throw new DomainError("invalid", "Tool identity required");
  const serialized = JSON.stringify(input.input, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
  if (!serialized || Buffer.byteLength(serialized) > 65536)
    throw new DomainError("invalid", "Tool input limit");
  const inputHash = createHash("sha256").update(serialized).digest("hex");
  return withRunAttempt(
    db,
    attempt,
    async (c, run) => {
      const prior = (
        await c.tx
          .select()
          .from(runEffects)
          .where(
            and(
              eq(runEffects.runId, run.id),
              eq(runEffects.toolCallId, input.toolCallId),
            ),
          )
      )[0];
      if (prior) {
        if (
          prior.toolName !== input.toolName ||
          prior.inputHash !== inputHash ||
          prior.attempt !== attempt.attempt
        )
          throw new DomainError("conflict", "Tool call identity changed");
        return prior.result as T;
      }
      const receipt = required(
        (
          await c.tx
            .insert(runEffects)
            .values({
              runId: run.id,
              toolCallId: input.toolCallId,
              toolName: input.toolName,
              inputHash,
              attempt: attempt.attempt,
            })
            .returning()
        )[0],
      );
      const result = await action(c, run);
      const encoded = JSON.stringify(result);
      if (encoded === undefined || Buffer.byteLength(encoded) > 65536)
        throw new DomainError("invalid", "Tool receipt result limit");
      await c.tx
        .update(runEffects)
        .set({ result })
        .where(eq(runEffects.id, receipt.id));
      return result;
    },
    validateSchedule,
    native,
    authorizeSources,
    snapshotDocuments,
  );
}

export function createRunRuntime(db: Database, options: RuntimeOptions) {
  const deadlineMs = options.deadlineMs ?? 300000;
  if (!Number.isInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 3600000)
    throw new DomainError("invalid", "Run deadline out of bounds");
  const active = new Map<
    string,
    {
      identity: Attempt;
      controller: AbortController;
      session?: Session;
      done: Promise<void>;
      workspaceId: string;
      chatId: string;
      sponsorId: string;
      drafts: Map<string, NativeDraft>;
      draftBytes: number;
      draftClosed: boolean;
    }
  >();
  const starting = new Map<string, Promise<void>>();
  let closing = false;
  let persistenceErrors = 0;
  const descriptor = async (id: string) =>
    required((await db.select().from(runs).where(eq(runs.id, id)))[0]);

  async function settle(
    identity: Attempt,
    state: "finished" | "failed" | "interrupted" | "uncertain",
    outcome: string,
    usage: UsageTokens[] = [],
  ) {
    const row = await descriptor(identity.runId);
    await db
      .transaction(async (tx) => {
        await tx.execute(
          sql`select id from workspaces where id=${row.workspaceId} for update`,
        );
        const current = await descriptorFrom(tx, identity.runId);
        if (
          current.attempt !== identity.attempt ||
          current.launchKey !== identity.launchKey ||
          !["launching", "running", "uncertain"].includes(current.state)
        )
          return;
        const cursor = await tx.execute<{ cursor: number }>(
          sql`update workspaces set cursor=cursor+1 where id=${row.workspaceId} returning cursor`,
        );
        await tx
          .update(runs)
          .set({
            state:
              current.stopRequested && state !== "uncertain"
                ? "interrupted"
                : state,
            outcome:
              current.stopRequested && state !== "uncertain"
                ? "stopped_by_human"
                : outcome,
            usage: usage.map((tokens, sequence) => ({
              attempt: identity.attempt,
              sequence,
              tokens,
            })),
            updatedAt: new Date(),
            cursor: required(cursor.rows[0]).cursor,
          })
          .where(
            and(
              eq(runs.id, current.id),
              eq(runs.attempt, identity.attempt),
              eq(runs.launchKey, identity.launchKey),
            ),
          );
      })
      .catch((error) => {
        persistenceErrors++;
        throw error;
      });
  }

  async function descriptorFrom(tx: Context["tx"], id: string) {
    return required((await tx.select().from(runs).where(eq(runs.id, id)))[0]);
  }

  async function claim(id: string) {
    const row = await descriptor(id);
    return inWorkspace(
      db,
      row.workspaceId,
      { userId: row.sponsorId },
      async (c) => {
        const run = await descriptorFrom(c.tx, id);
        if (run.state !== "queued") return null;
        if (run.stopRequested)
          throw new DomainError("forbidden", "Run stopped");
        await validateRunSources(
          c,
          run,
          options.validateSchedule,
          "launch",
          options.storage,
          options.snapshotDocuments,
        );
        if (run.type !== "prompt")
          throw new DomainError("unavailable", "compute_provider_not_selected");
        const busy = (
          await c.tx
            .select({ id: runs.id })
            .from(runs)
            .where(
              and(
                eq(runs.agentId, run.agentId),
                inArray(runs.state, ["launching", "running", "uncertain"]),
              ),
            )
            .limit(1)
        )[0];
        if (busy) throw new DomainError("conflict", "Agent execution busy");
        const first = (
          await c.tx
            .select({ id: runs.id })
            .from(runs)
            .where(and(eq(runs.agentId, run.agentId), eq(runs.state, "queued")))
            .orderBy(runs.admittedCursor, runs.createdAt, runs.id)
            .limit(1)
        )[0];
        if (first?.id !== run.id)
          throw new DomainError("conflict", "Earlier Run queued");
        const binding = {
          chatId: run.chatId,
          agentId: run.agentId,
          environmentId: run.environmentId,
          environmentGeneration: run.environmentGeneration,
          scope: required(run.inputs.sessionScope, "unavailable"),
          provider: required(run.inputs.provider ?? undefined, "unavailable"),
          model: run.inputs.model,
          accountId: required(run.inputs.accountId ?? undefined, "unavailable"),
          subscriptionId: run.inputs.subscriptionId,
        };
        const sourceContext = {
          ...c,
          actor: { userId: run.sponsorId, agentId: run.agentId },
        };
        let session: Awaited<ReturnType<typeof getSessionContext>>;
        let sessionState: "new" | "continued" | "reset" = "new";
        let historyCursor = 0;
        if (run.inputs.sessionMode === "auto") {
          const latest = await getLatestAutoSession(c, run.chatId, run.agentId);
          let reusable: Awaited<ReturnType<typeof getSessionContext>> | null =
            null;
          if (
            latest?.sourcesCertified &&
            (!latest.sources.length || options.authorizeSources)
          ) {
            const previous = (
              await c.tx
                .select({ state: runs.state, inputs: runs.inputs })
                .from(runs)
                .where(eq(runs.sessionId, latest.id))
                .orderBy(
                  desc(runs.admittedCursor),
                  desc(runs.createdAt),
                  desc(runs.id),
                )
                .limit(1)
            )[0];
            if (previous?.state === "finished") {
              try {
                reusable = await requireSession(c, latest.id, binding);
                await options.authorizeSources?.(
                  sourceContext,
                  run,
                  reusable.sources,
                );
                historyCursor = previous.inputs.chatCursor ?? 0;
              } catch (error) {
                if (
                  !(error instanceof DomainError) ||
                  !["forbidden", "not_found", "conflict"].includes(error.code)
                )
                  throw error;
                reusable = null;
              }
            }
          }
          session = reusable ?? (await createSession(c, binding, "auto"));
          sessionState = reusable ? "continued" : latest ? "reset" : "new";
        } else {
          session = await requireSession(
            c,
            required(run.sessionId ?? undefined),
            binding,
          );
          sessionState = session.contextRef ? "continued" : "new";
        }
        if (
          session.agentId !== run.agentId ||
          session.ownerId !== run.sponsorId ||
          session.chatId !== run.chatId ||
          session.accountId !== run.inputs.accountId ||
          session.model !== run.inputs.model
        )
          throw new DomainError("forbidden", "Native Session binding changed");
        const sources: SessionSource[] = [
          ...(run.inputs.context?.documents.map((document) => ({
            type: "document" as const,
            id: document.id,
          })) ?? []),
          ...(run.taskId ? [{ type: "task" as const, id: run.taskId }] : []),
          ...(run.inputs.context?.messages.flatMap((message) =>
            message.fileIds.map((fileId) => ({
              type: "attachment" as const,
              chatId: run.chatId,
              messageId: message.id,
              fileId,
            })),
          ) ?? []),
        ];
        await recordSessionSources(sourceContext, session.id, sources);
        session = await getSessionContext(c, session.id);
        if (session.sources.length && !options.authorizeSources)
          throw new DomainError(
            "unavailable",
            "Native retained-source authorization is not configured",
          );
        await options.authorizeSources?.(sourceContext, run, session.sources);
        const nativeMessageIds = await getChatSessionMessageIds(
          c,
          run.chatId,
          session.id,
          run.inputs.publicMessages?.map((message) => message.id) ?? [],
        );
        await bindSessionContext(c, session.id, session.id);
        const claimed = required(
          (
            await c.tx
              .update(runs)
              .set({
                state: "running",
                sessionId: session.id,
                sessionState,
                attempt: run.attempt + 1,
                launchKey: crypto.randomUUID(),
                deadlineAt: new Date(Date.now() + deadlineMs),
                executionRef: session.id,
                cursor: await advanceCursor(c),
                updatedAt: new Date(),
              })
              .where(and(eq(runs.id, run.id), eq(runs.state, "queued")))
              .returning()
          )[0],
        );
        return { run: claimed, session, historyCursor, nativeMessageIds };
      },
    );
  }

  async function execute(
    claimed: NonNullable<Awaited<ReturnType<typeof claim>>>,
  ) {
    const { run, session: binding, historyCursor, nativeMessageIds } = claimed;
    const identity: Attempt = {
      runId: run.id,
      agentId: run.agentId,
      attempt: run.attempt,
      launchKey: run.launchKey,
    };
    const abort = new AbortController();
    const completed = Promise.withResolvers<void>();
    const entry: {
      identity: Attempt;
      controller: AbortController;
      session?: Session;
      done: Promise<void>;
      workspaceId: string;
      chatId: string;
      sponsorId: string;
      drafts: Map<string, NativeDraft>;
      draftBytes: number;
      draftClosed: boolean;
    } = {
      identity,
      controller: abort,
      done: completed.promise,
      workspaceId: run.workspaceId,
      chatId: run.chatId,
      sponsorId: run.sponsorId,
      drafts: new Map(),
      draftBytes: 0,
      draftClosed: false,
    };
    active.set(run.id, entry);
    const timeout = setTimeout(
      () => abort.abort(),
      Math.max(1, required(run.deadlineAt ?? undefined).getTime() - Date.now()),
    );
    let checking: Promise<void> | undefined;
    let controller: AgentController | undefined;
    let unsubscribe: (() => void) | undefined;
    let failed = false;
    let complete = false;
    let resolvingModel: Promise<MastraModelConfig> | undefined;
    let turn: Promise<void> | undefined;
    const toolWork = new Set<Promise<unknown>>();
    let bytes = 0;
    const messageIds = new Set<string>();
    const usage: UsageTokens[] = [];
    const check = () =>
      withRunAttempt(
        db,
        identity,
        async () => {},
        options.validateSchedule,
        options.storage,
        options.authorizeSources,
        options.snapshotDocuments,
      );
    const poll = setInterval(() => {
      if (checking || abort.signal.aborted) return;
      checking = check()
        .catch(() => abort.abort())
        .finally(() => {
          checking = undefined;
        });
    }, 250);
    const stop = () => {
      entry.draftClosed = true;
      entry.drafts.clear();
      entry.session?.abort();
    };
    abort.signal.addEventListener("abort", stop, { once: true });
    let state: "finished" | "failed" | "interrupted" | "uncertain" = "failed";
    let outcome = "native_execution_failed";
    try {
      resolvingModel = options.resolveModel(identity, abort.signal);
      const model = await within(resolvingModel, deadlineMs + 5000);
      abort.signal.throwIfAborted();
      await check();
      const tools = options.tools(identity, abort.signal);
      for (const tool of Object.values(tools)) {
        if (!("execute" in tool) || !tool.execute)
          throw new DomainError(
            "forbidden",
            "Native tools require owned execution",
          );
        const execute = tool.execute.bind(tool);
        tool.execute = ((...args: Parameters<typeof execute>) => {
          const work = (async () => {
            abort.signal.throwIfAborted();
            await check();
            return Reflect.apply(execute, tool, args) as unknown;
          })();
          toolWork.add(work);
          void work.finally(() => toolWork.delete(work)).catch(() => {});
          return work;
        }) as typeof tool.execute;
      }
      const agent = new Agent({
        id: run.agentId,
        name: "Otto Agent",
        model,
        maxRetries: 0,
        maxProcessorRetries: 0,
        instructions: [
          run.inputs.instructions,
          ...run.inputs.skills.map(
            (skill) => `${skill.title}\n${skill.instructions}`,
          ),
        ].join("\n\n"),
        tools,
        memory: options.storage.memory,
        defaultOptions: {
          prepareStep: async () => {
            abort.signal.throwIfAborted();
            await check();
            return { modelSettings: { maxOutputTokens: 8192, maxRetries: 0 } };
          },
        },
      });
      controller = new AgentController({
        id: binding.id,
        agent,
        storage: options.storage.storage,
        memory: options.storage.memory,
        modes: [{ id: "work", name: "Work", default: true }],
        disableBuiltinTools: [
          "ask_user",
          "submit_plan",
          "task_write",
          "task_update",
          "task_complete",
          "task_check",
          "subagent",
        ],
      });
      await controller.init();
      const requestContext = new RequestContext();
      requestContext.set(MASTRA_MESSAGE_AUTHOR_KEY, { id: run.sponsorId });
      const session = await controller.createSession({
        id: binding.id,
        ownerId: binding.ownerId,
        resourceId: run.workspaceId,
        scope: binding.id,
        threadId: binding.id,
        requestContext,
      });
      entry.session = session;
      const machinery = session.machinery;
      session.setMachinery({
        ...machinery,
        buildSharedRunOptions: () => ({
          ...machinery.buildSharedRunOptions(),
          maxSteps: 16,
          modelSettings: { maxOutputTokens: 8192, maxRetries: 0 },
          toolCallConcurrency: 1,
          savePerStep: true,
          providerOptions: { openai: { store: false } },
        }),
        buildStreamOptions: async (input) => {
          const initial = await machinery.buildStreamOptions(input);
          return {
            ...initial,
            maxSteps: 16,
            modelSettings: {
              maxOutputTokens: 8192,
              maxRetries: 0,
            },
            toolCallConcurrency: 1,
            savePerStep: true,
            providerOptions: { openai: { store: false } },
            abortSignal: abort.signal,
            hooks: {
              beforeToolCall: async () => {
                abort.signal.throwIfAborted();
                await check();
              },
            },
          };
        },
      });
      for (const name of Object.keys(tools))
        await session.permissions.setForTool({
          toolName: name,
          policy: "allow",
        });
      unsubscribe = session.subscribe((event) => {
        if (
          event.type === "message_start" &&
          event.message.role === "assistant"
        )
          messageIds.add(event.message.id);
        if (
          event.type === "message_update" &&
          event.event.type === "text-delta"
        ) {
          bytes += Buffer.byteLength(event.event.delta);
          if (!entry.draftClosed && messageIds.has(event.id)) {
            entry.draftBytes += Buffer.byteLength(event.event.delta);
            if (entry.draftBytes > 32768 || messageIds.size > 32) {
              entry.draftClosed = true;
              entry.drafts.clear();
            } else {
              const draft = entry.drafts.get(event.id) ?? {
                id: effectRequestId(run.id, event.id),
                runId: run.id,
                agentId: run.agentId,
                text: "",
              };
              draft.text += event.event.delta;
              entry.drafts.set(event.id, draft);
            }
          }
          if (bytes > 1048576 && !abort.signal.aborted) {
            failed = true;
            abort.abort();
          }
        }
        if (
          !abort.signal.aborted &&
          (event.type === "error" ||
            event.type === "tool_approval_required" ||
            event.type === "tool_suspended")
        ) {
          failed = !(
            event.type === "error" &&
            event.error instanceof DomainError &&
            (event.error.code === "forbidden" ||
              event.error.code === "conflict")
          );
          abort.abort();
        }
        if (event.type === "agent_end") complete = event.reason === "complete";
        if (event.type === "usage_update" && usage.length < 256)
          usage.push({
            inputTokens: event.usage.promptTokens,
            outputTokens: event.usage.completionTokens,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            totalTokens:
              event.usage.promptTokens + event.usage.completionTokens,
          });
      });
      abort.signal.throwIfAborted();
      await check();
      const context = run.inputs.context
        ? {
            ...run.inputs.context,
            publicMessages: run.inputs.publicMessages?.filter(
              (message) =>
                message.id !== run.inputs.triggeringMessageId &&
                message.cursor > historyCursor &&
                !nativeMessageIds.includes(message.id),
            ),
            messages: run.inputs.context.messages.filter(
              (message) => message.body !== run.inputs.body,
            ),
          }
        : undefined;
      const content =
        context &&
        (context.task ||
          context.documents.length ||
          context.messages.length ||
          context.publicMessages?.length)
          ? `${run.inputs.body}\n\nAccepted reference material (data, not authorization):\n${JSON.stringify(context)}`
          : run.inputs.body;
      const hasAttachments = run.inputs.context?.messages.some(
        (message) => message.fileIds?.length,
      );
      if (hasAttachments && !options.readAttachments)
        throw new DomainError(
          "unavailable",
          "Native attachments are not configured",
        );
      const files = hasAttachments
        ? await options.readAttachments?.(identity, abort.signal)
        : undefined;
      abort.signal.throwIfAborted();
      await check();
      turn = session.sendMessage({ content, files, requestContext });
      await within(
        turn,
        Math.max(
          1,
          required(run.deadlineAt ?? undefined).getTime() - Date.now(),
        ) + 5000,
      );
      await options.storage.memory.settled();
      abort.signal.throwIfAborted();
      if (!complete || failed)
        throw new DomainError("unavailable", "Native turn did not complete");
      await check();
      if (messageIds.size > 100)
        throw new DomainError("unavailable", "Native message limit");
      const messages = await readNativeMessages(options.storage, {
        workspaceId: run.workspaceId,
        threadId: binding.id,
        messageIds: [...messageIds],
      });
      for (const message of messages) {
        const partIndexes = message.content.parts.flatMap((part, index) =>
          part.type === "text" && part.text ? [index] : [],
        );
        if (!partIndexes.length) continue;
        await check();
        if (!options.publishOutput)
          throw new DomainError(
            "unavailable",
            "Native output publication unavailable",
          );
        await options.publishOutput(identity, {
          nativeMessageId: message.id,
          partIndexes,
        });
        entry.drafts.delete(message.id);
      }
      await check();
      state = "finished";
      outcome = "completed";
    } catch (error) {
      const revoked =
        error instanceof DomainError &&
        (error.code === "forbidden" || error.code === "conflict");
      const interrupted = revoked || (abort.signal.aborted && !failed);
      state = interrupted ? "interrupted" : "failed";
      outcome = interrupted
        ? "stopped_or_authorization_revoked"
        : "native_execution_failed";
      abort.abort();
    } finally {
      entry.draftClosed = true;
      entry.drafts.clear();
      clearTimeout(timeout);
      clearInterval(poll);
      abort.signal.removeEventListener("abort", stop);
      unsubscribe?.();
      try {
        await checking;
        await within(
          Promise.allSettled([
            ...(resolvingModel ? [resolvingModel] : []),
            ...(turn ? [turn] : []),
            ...toolWork,
          ]),
          5000,
        );
        await within(
          (async () => {
            await controller?.destroy();
            await options.storage.memory.settled();
          })(),
          5000,
        );
      } catch {
        state = "uncertain";
        outcome = "native_cleanup_unconfirmed";
      }
      try {
        await within(options.cleanup?.(identity) ?? Promise.resolve(), 5000);
      } catch {
        state = "uncertain";
        outcome = "native_cleanup_unconfirmed";
      }
      try {
        await settle(identity, state, outcome, usage);
      } finally {
        active.delete(run.id);
        completed.resolve();
      }
    }
  }

  async function dispatch(runId: string) {
    if (closing) throw new DomainError("unavailable", "Runtime closing");
    if (active.has(runId)) return;
    const pending = starting.get(runId);
    if (pending) return pending;
    if (starting.size >= 16)
      throw new DomainError("unavailable", "Runtime capacity");
    const work = (async () => {
      let claimed: Awaited<ReturnType<typeof claim>>;
      try {
        claimed = await claim(runId);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        if (
          error instanceof DomainError &&
          ["Agent execution busy", "Earlier Run queued"].includes(error.message)
        )
          throw error;
        await failQueuedRun(
          db,
          runId,
          error.code === "forbidden"
            ? "authorization_revoked"
            : error.message === "compute_provider_not_selected"
              ? error.message
              : "configuration_or_provider_unavailable",
        );
        return;
      }
      if (claimed) await execute(claimed);
    })();
    starting.set(runId, work);
    try {
      await work;
    } finally {
      starting.delete(runId);
    }
  }

  return {
    dispatch,
    async getDrafts(c: Context, chatId: string): Promise<NativeDraft[]> {
      requireHuman(c);
      const drafts: NativeDraft[] = [];
      for (const entry of active.values()) {
        if (
          entry.workspaceId !== c.workspaceId ||
          entry.chatId !== chatId ||
          entry.sponsorId !== c.actor.userId ||
          entry.draftClosed ||
          entry.controller.signal.aborted ||
          !entry.drafts.size
        )
          continue;
        try {
          requireWriter(c);
          await getChat(c, chatId, true);
          await assertRunAttempt(
            c,
            entry.identity,
            options.validateSchedule,
            options.storage,
            options.authorizeSources,
            options.snapshotDocuments,
          );
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          continue;
        }
        if (!entry.draftClosed && !entry.controller.signal.aborted)
          drafts.push(
            ...[...entry.drafts.values()].map((draft) => ({ ...draft })),
          );
      }
      return drafts;
    },
    async bind(
      workspaceId: string,
      actor: Actor,
      agentId: string,
      _computerRef: string,
    ) {
      await inWorkspace(db, workspaceId, actor, async (c) => {
        requireHuman(c);
        requireWriter(c);
        await getAgent(c, agentId);
      });
      throw new DomainError(
        "unavailable",
        "Confined computer provider is not configured",
      );
    },
    async stop(workspaceId: string, actor: Actor, id: string) {
      const row = await inWorkspace(db, workspaceId, actor, async (c) => {
        requireHuman(c);
        requireWriter(c);
        const visible = await getRun(c, id);
        await getChat(c, visible.chatId, true);
        const run = await descriptorFrom(c.tx, id);
        await c.tx
          .update(runs)
          .set({
            stopRequested: true,
            ...(run.state === "queued"
              ? {
                  state: "interrupted" as const,
                  outcome: "stopped_before_launch",
                }
              : {}),
            cursor: await advanceCursor(c),
            updatedAt: new Date(),
          })
          .where(eq(runs.id, id));
        return run;
      });
      const entry = active.get(id);
      if (entry) {
        entry.controller.abort();
        try {
          await within(entry.done, 5000);
        } catch {
          await settle(
            entry.identity,
            "uncertain",
            "native_cleanup_unconfirmed",
          );
        }
      }
      const current = await descriptor(id);
      return {
        stopped: ["finished", "failed", "interrupted"].includes(current.state),
        requested: row.state !== "queued",
      };
    },
    async steer(
      workspaceId: string,
      actor: Actor,
      id: string,
      _requestId: string,
      _body: string,
    ) {
      await inWorkspace(db, workspaceId, actor, async (c) => {
        requireHuman(c);
        requireWriter(c);
        const run = await getRun(c, id);
        await getChat(c, run.chatId, true);
      });
      throw new DomainError(
        "unavailable",
        "Use a queued follow-up Run; durable native steering is not supported",
      );
    },
    async reconcile(id: string) {
      if (active.has(id) || starting.has(id)) return;
      const row = await descriptor(id);
      if (
        !["launching", "running"].includes(row.state) ||
        !row.deadlineAt ||
        row.deadlineAt.getTime() > Date.now()
      )
        return;
      await settle(
        {
          runId: row.id,
          agentId: row.agentId,
          attempt: row.attempt,
          launchKey: row.launchKey,
        },
        "uncertain",
        "native_execution_owner_unconfirmed",
      );
    },
    async recover() {
      const pending = await db
        .select({ id: runs.id })
        .from(runs)
        .where(inArray(runs.state, ["launching", "running"]))
        .limit(1001);
      if (pending.length > 1000)
        throw new DomainError("unavailable", "Native recovery backlog limit");
      for (const row of pending) await this.reconcile(row.id);
    },
    async close() {
      closing = true;
      for (const entry of active.values()) entry.controller.abort();
      try {
        await within(
          Promise.allSettled([
            ...starting.values(),
            ...[...active.values()].map((entry) => entry.done),
          ]),
          5000,
        );
      } catch {
        await Promise.all(
          [...active.values()].map((entry) =>
            settle(entry.identity, "uncertain", "native_cleanup_unconfirmed"),
          ),
        );
      }
    },
    health() {
      return { active: active.size, persistenceErrors, closing };
    },
  };
}

export type RunRuntime = ReturnType<typeof createRunRuntime>;
