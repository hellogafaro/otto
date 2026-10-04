import { isDeepStrictEqual } from "node:util";
import { getConversation } from "@otto/conversations";
import type { Database } from "@otto/db";
import {
  bindEnvironment,
  bindExecutionScope,
  type ComputerBackend,
  type ComputerProcess,
  claimEnvironment,
  getEnvironment,
  getExecutionComputer,
  requireComputerCapabilities,
  settleEnvironment,
} from "@otto/environments";
import { bindSessionContext, getSessionContext } from "@otto/sessions";
import { DomainError, required, withCleanup } from "@otto/shared";

import {
  type Actor,
  advanceCursor,
  type Context,
  inWorkspace,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  failQueuedRun,
  getRun,
  type PiInstallation,
  validateRunSources,
} from "./index";
import { connectPi } from "./pi";
import { runActivity, runs, type UsageTokens } from "./schema";

export interface Attempt {
  runId: string;
  agentId: string;
  attempt: number;
  launchKey: string;
}
interface RuntimeOptions {
  backend: ComputerBackend;
  /** Server-configured pinned commands only; no browser command or credential interpolation. */
  pi: PiInstallation;
  validateAutomation?: (
    c: Context,
    id: string,
    editToken: number,
  ) => Promise<void>;
  handleTool?: (
    attempt: Attempt,
    input: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readSkillFile?: (input: {
    workspaceId: string;
    sponsorId: string;
    runId: string;
    skillId: string;
    path: string;
  }) => Promise<Uint8Array>;
  /** Exact deployment source and owning server tool schema, materialized only in this retained scope. */
  extensionSource?: string;
  toolSchema?: unknown;
  /** Attempt-only proxy access; never an upstream OAuth credential. */
  modelAccess?: (attempt: Attempt) => Promise<{
    baseUrl: string;
    token: string;
    release?: () => Promise<void>;
  }>;
  deadlineMs?: number;
}
const MAX_OUTPUT_BYTES = 1048576;
const MAX_ACTIVE = 16;
export interface Usage extends UsageTokens {
  sequence: number;
  provider: string;
  model: string;
}
/** Private trusted composition entry: no user supplied actor/agent/run pairing is accepted. */
export async function withRunAttempt<T>(
  db: Database,
  identity: Attempt,
  action: (c: Context, run: typeof runs.$inferSelect) => Promise<T>,
  validateAutomation?: RuntimeOptions["validateAutomation"],
) {
  const descriptor = required(
    (await db.select().from(runs).where(eq(runs.id, identity.runId)))[0],
  );
  return inWorkspace(
    db,
    descriptor.workspaceId,
    { userId: descriptor.sponsorId, agentId: identity.agentId },
    async (c) => {
      const run = await assertRunAttempt(c, identity, validateAutomation);
      return action(c, run);
    },
  );
}
/** Reusable within the caller's authorization transaction, including protected external operations. */
export async function assertRunAttempt(
  c: Context,
  identity: Attempt,
  validateAutomation?: RuntimeOptions["validateAutomation"],
) {
  const run = required(
    (await c.tx.select().from(runs).where(eq(runs.id, identity.runId)))[0],
  );
  if (
    run.workspaceId !== c.workspaceId ||
    run.sponsorId !== c.actor.userId ||
    run.agentId !== identity.agentId ||
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
    validateAutomation,
    "continue",
  );
  const env = await getEnvironment(c, run.agentId);
  if (
    env.activeRunId !== run.id ||
    env.state !== "ready" ||
    env.executionScope !== executionScope(run)
  )
    throw new DomainError("forbidden", "Execution lease lost");
  return run;
}
/** Exact accepted sources retained by this computer. Incomplete legacy scopes cannot be reused. */
function executionScope(run: typeof runs.$inferSelect) {
  if (!run.inputs.context)
    throw new DomainError("conflict", "Retained source scope unavailable");
  return JSON.stringify({
    sponsorId: run.sponsorId,
    conversationId: run.conversationId,
    subscriptionId: run.inputs.subscriptionId,
    accountId: run.inputs.accountId,
    humans: run.inputs.audience.humans.slice().sort(),
    agents: run.inputs.audience.agents.slice().sort(),
    grants: run.inputs.grants,
    sources: {
      taskId: run.taskId,
      documentIds: run.inputs.context.documents.map((d) => d.id).sort(),
      messageIds: run.inputs.context.messages.map((m) => m.id).sort(),
      skills: run.inputs.skills
        .map((skill) => ({
          documentId: skill.documentId,
          files: skill.supportingFiles ?? [],
        }))
        .sort((a, b) => a.documentId.localeCompare(b.documentId)),
    },
  });
}
async function within<T>(operation: Promise<T>, timeoutMs = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new DomainError("unavailable", "Computer operation timed out"),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function createRunRuntime(db: Database, options: RuntimeOptions) {
  const active = new Map<
    string,
    {
      process: ComputerProcess;
      controller: AbortController;
      pi?: ReturnType<typeof connectPi>;
      promptStarted?: boolean;
      releaseModel?: () => Promise<void>;
      done: Promise<void>;
      timer?: ReturnType<typeof setTimeout>;
      stopTimer?: ReturnType<typeof setInterval>;
    }
  >();
  const starting = new Map<string, Promise<void>>();
  const errors: unknown[] = [];
  const rememberError = (error: unknown) => {
    if (errors.length < 16) errors.push(error);
  };
  let closing = false;
  const deadlineMs = Math.min(
    3600000,
    Math.max(100, options.deadlineMs ?? 900000),
  );
  const descriptor = async (id: string) =>
    required((await db.select().from(runs).where(eq(runs.id, id)))[0]);
  async function settle(
    identity: Attempt,
    state: "finished" | "failed" | "interrupted" | "uncertain",
    outcome: string,
    stopped: boolean,
  ) {
    const row = await descriptor(identity.runId);
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from workspaces where id=${row.workspaceId} for update`,
      );
      const current = required(
        (await tx.select().from(runs).where(eq(runs.id, row.id)))[0],
      );
      if (
        current.outcome === "tool_cleanup_unconfirmed" ||
        current.attempt !== identity.attempt ||
        current.launchKey !== identity.launchKey ||
        !["launching", "running", "uncertain"].includes(current.state)
      )
        return;
      const cursor = await tx.execute<{ cursor: number }>(
        sql`update workspaces set cursor=cursor+1 where id=${row.workspaceId} returning cursor`,
      );
      await settleEnvironment(
        tx,
        row.workspaceId,
        row.agentId,
        row.id,
        row.environmentGeneration,
        stopped,
      );
      await tx
        .update(runs)
        .set({
          state,
          // A failed inspection or unconfirmed Stop must not erase a missing
          // launch acknowledgement. Only authoritative stopped proof clears it.
          outcome:
            !stopped &&
            current.outcome === "launch_acknowledgement_missing" &&
            outcome !== "tool_cleanup_unconfirmed"
              ? current.outcome
              : outcome,
          cursor: required(cursor.rows[0]).cursor,
          updatedAt: new Date(),
        })
        .where(eq(runs.id, row.id));
    });
  }
  async function output(
    c: Context,
    run: typeof runs.$inferSelect,
    identity: Attempt,
    sequence: number,
    body: string,
  ) {
    if (!body) return;
    const bytes = Buffer.byteLength(body);
    if (bytes > 65536 || run.outputBytes + bytes > MAX_OUTPUT_BYTES)
      throw new DomainError("unavailable", "Run output limit");
    const cursor = await advanceCursor(c);
    await c.tx.insert(runActivity).values({
      workspaceId: c.workspaceId,
      runId: run.id,
      requestId: `output:${identity.attempt}:${sequence}`,
      type: "output",
      body,
      cursor,
    });
    await c.tx
      .update(runs)
      .set({ outputBytes: run.outputBytes + bytes, cursor })
      .where(eq(runs.id, run.id));
  }
  async function usage(
    c: Context,
    run: typeof runs.$inferSelect,
    identity: Attempt,
    value: Usage,
  ) {
    if (
      value.provider !== run.inputs.provider ||
      value.model !== run.inputs.model ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 1 ||
      value.sequence > 256
    )
      throw new DomainError("forbidden", "Usage attribution mismatch");
    const tokens: UsageTokens = {
      inputTokens: value.inputTokens,
      outputTokens: value.outputTokens,
      cacheReadTokens: value.cacheReadTokens,
      cacheWriteTokens: value.cacheWriteTokens,
      totalTokens: value.totalTokens,
    };
    if (
      Object.values(tokens).some(
        (n) =>
          n !== null &&
          (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000_000_000),
      )
    )
      throw new DomainError("invalid", "Invalid reported usage");
    const prior = run.usage.find(
      (message) =>
        message.attempt === identity.attempt &&
        message.sequence === value.sequence,
    );
    if (prior) {
      if (!isDeepStrictEqual(prior.tokens, tokens))
        throw new DomainError("conflict", "Usage message already recorded");
      return;
    }
    if (run.usage.length >= 256)
      throw new DomainError("unavailable", "Run usage message limit");
    const cursor = await advanceCursor(c);
    await c.tx
      .update(runs)
      .set({
        usage: [
          ...run.usage,
          { attempt: identity.attempt, sequence: value.sequence, tokens },
        ],
        cursor,
      })
      .where(eq(runs.id, run.id));
  }
  async function stopTree(process: ComputerProcess) {
    try {
      return (await within(process.stop())).stopped;
    } catch {
      // Every caller persists uncertainty and retains the Environment lease below.
      return false;
    }
  }
  async function stopProcess(
    identity: Attempt,
    process: ComputerProcess,
    outcome: string,
  ) {
    if (
      (await descriptor(identity.runId)).outcome === "tool_cleanup_unconfirmed"
    )
      return false;
    const entry = active.get(identity.runId);
    entry?.controller.abort();
    // Server-side tool I/O must also finish: a remote tree acknowledgement
    // cannot prove an ignored-cancellation tool stopped producing side effects.
    const cleanup = await Promise.allSettled([
      stopTree(process),
      entry?.pi?.close() ?? Promise.resolve(),
      entry?.releaseModel?.() ?? Promise.resolve(),
    ]);
    const treeStopped = cleanup[0].status === "fulfilled" && cleanup[0].value;
    const toolsStopped =
      cleanup[1].status === "fulfilled" && cleanup[2].status === "fulfilled";
    const stopped = treeStopped && toolsStopped;
    await settle(
      identity,
      stopped ? "interrupted" : "uncertain",
      !toolsStopped
        ? "tool_cleanup_unconfirmed"
        : stopped
          ? outcome
          : "process_stop_unconfirmed",
      stopped,
    );
    return stopped;
  }
  async function dispatch(id: string) {
    if (active.has(id)) return;
    const pending = starting.get(id);
    if (pending) return pending;
    if (closing || errors.length || active.size + starting.size >= MAX_ACTIVE)
      throw new DomainError("unavailable", "Runtime capacity");
    const work = dispatchRun(id);
    starting.set(id, work);
    try {
      await work;
    } finally {
      starting.delete(id);
    }
  }
  async function dispatchRun(id: string) {
    const row = await descriptor(id);
    if (row.state !== "queued") return;
    const busy = new DomainError("unavailable", "Environment busy");
    const prepared = await inWorkspace(
      db,
      row.workspaceId,
      { userId: row.sponsorId },
      async (c) => {
        const run = required(
          (await c.tx.select().from(runs).where(eq(runs.id, id)))[0],
        );
        if (run.state !== "queued") return null;
        await validateRunSources(c, run, options.validateAutomation);
        if (Date.now() - run.createdAt.getTime() > 600000)
          throw new DomainError("conflict", "Queue deadline exceeded");
        const currentEnvironment = await getEnvironment(c, run.agentId);
        if (
          currentEnvironment.activeRunId &&
          currentEnvironment.activeRunId !== run.id
        )
          throw busy;
        const env = await claimEnvironment(
          c,
          run.agentId,
          run.id,
          run.environmentGeneration,
        );
        if (env.provider !== options.backend.provider || !env.computerRef)
          throw new DomainError(
            "unavailable",
            "Configured computer unavailable",
          );
        const scope = executionScope(run);
        await bindExecutionScope(c, run.agentId, scope);
        const pi = options.pi;
        if (
          run.type === "prompt" &&
          (!pi || pi.version !== run.inputs.piVersion)
        )
          throw new DomainError("unavailable", "Managed Pi not configured");
        const cursor = await advanceCursor(c);
        const deadlineAt = new Date(Date.now() + deadlineMs);
        const attempt = run.attempt + 1;
        await c.tx
          .update(runs)
          .set({
            state: "launching",
            attempt,
            deadlineAt,
            cursor,
            updatedAt: new Date(),
          })
          .where(eq(runs.id, id));
        return {
          run,
          env,
          deadlineAt,
          attempt,
          scope,
          argv:
            run.type === "script"
              ? ["/bin/sh", "-c", run.inputs.body]
              : pi.argv,
        };
      },
    ).catch(async (error: unknown) => {
      if (!(error instanceof DomainError) || error === busy) throw error;
      await failQueuedRun(
        db,
        id,
        error.code === "forbidden"
          ? "authorization_revoked"
          : "admission_configuration_unavailable",
      );
      return null;
    });
    if (!prepared) return;
    const identity = {
      runId: id,
      agentId: row.agentId,
      attempt: prepared.attempt,
      launchKey: row.launchKey,
    };
    let process: ComputerProcess;
    let launchStarted = false;
    let releaseModel: (() => Promise<void>) | undefined;
    try {
      const computer = await within(
        options.backend.inspectComputer(
          required(prepared.env.computerRef ?? undefined),
        ),
      );
      requireComputerCapabilities(computer.capabilities);
      const files: { path: string; bytes: Uint8Array }[] = [];
      let fileBytes = 0;
      let env: Readonly<Record<string, string>> | undefined;
      let argv = prepared.argv;
      if (row.type === "prompt") {
        if (
          !options.extensionSource ||
          !options.toolSchema ||
          !options.modelAccess
        )
          throw new DomainError(
            "unavailable",
            "Managed Pi model/tool configuration unavailable",
          );
        const toolSchema = JSON.stringify(options.toolSchema);
        if (new TextEncoder().encode(toolSchema).byteLength > 65536)
          throw new DomainError("unavailable", "Managed tool schema limit");
        const access = await within(options.modelAccess(identity));
        releaseModel = access.release;
        const directory = ".otto/pi";
        argv = [
          ...argv,
          "--offline",
          "--mode",
          "rpc",
          "--provider",
          required(row.inputs.provider ?? undefined),
          "--model",
          row.inputs.model,
          "--no-extensions",
          "--no-skills",
          "--no-prompt-templates",
          "--no-themes",
          "--no-context-files",
          "--tools",
          "read,write,edit,bash,otto",
          "-e",
          `${directory}/extension.ts`,
          "--session",
          `${directory}/sessions/${required(row.sessionId ?? undefined)}.jsonl`,
        ];
        env = {
          PI_CODING_AGENT_DIR: directory,
          PI_OFFLINE: "1",
          OTTO_MODEL_TOKEN: access.token,
          OTTO_TOOL_SCHEMA: toolSchema,
        };
        const modelConfig = {
          providers: {
            [required(row.inputs.provider ?? undefined)]: {
              api: "openai-responses",
              baseUrl: access.baseUrl,
              apiKey: "$OTTO_MODEL_TOKEN",
              models: [
                {
                  id: row.inputs.model,
                  name: row.inputs.model,
                  ...required(
                    row.inputs.modelConfig ?? undefined,
                    "unavailable",
                  ),
                },
              ],
            },
          },
        };
        files.push(
          {
            path: `${directory}/extension.ts`,
            bytes: new TextEncoder().encode(options.extensionSource),
          },
          {
            path: `${directory}/models.json`,
            bytes: new TextEncoder().encode(JSON.stringify(modelConfig)),
          },
          {
            path: `${directory}/settings.json`,
            bytes: new TextEncoder().encode(
              JSON.stringify({ enableModelFallback: false }),
            ),
          },
        );
        fileBytes += files.reduce(
          (total, file) => total + file.bytes.length,
          0,
        );
      }
      for (const skill of row.inputs.skills) {
        const instructions = new TextEncoder().encode(
          `---\nname: ${JSON.stringify(skill.title)}\ndescription: ${JSON.stringify(skill.whenToUse ?? skill.title)}\n---\n${skill.instructions}`,
        );
        files.push({
          path: `skills/${skill.documentId}/SKILL.md`,
          bytes: instructions,
        });
        fileBytes += instructions.length;
        for (const file of skill.supportingFiles ?? []) {
          if (!options.readSkillFile)
            throw new DomainError("unavailable", "Skill storage unavailable");
          const bytes = await within(
            options.readSkillFile({
              workspaceId: row.workspaceId,
              sponsorId: row.sponsorId,
              runId: id,
              skillId: skill.documentId,
              path: file.path,
            }),
          );
          if (
            bytes.length !== file.byteLength ||
            new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
              file.sha256
          )
            throw new DomainError("conflict", "Skill file integrity failed");
          fileBytes += bytes.length;
          files.push({
            path: `skills/${skill.documentId}/${file.path}`,
            bytes,
          });
          if (files.length > 128 || fileBytes > 16777216)
            throw new DomainError("unavailable", "Skill materialization limit");
        }
      }
      if (files.length > 128 || fileBytes > 16777216)
        throw new DomainError("unavailable", "Skill materialization limit");
      // Storage reads are asynchronous: authorization is checked again before remote launch.
      await inWorkspace(
        db,
        row.workspaceId,
        { userId: row.sponsorId },
        async (c) => {
          const current = required(
            (await c.tx.select().from(runs).where(eq(runs.id, id)))[0],
          );
          if (current.state !== "launching" || current.stopRequested)
            throw new DomainError("conflict");
          await validateRunSources(
            c,
            current,
            options.validateAutomation,
            "launch",
          );
        },
      );
      launchStarted = true;
      process = await within(
        options.backend.launch({
          computerRef: required(prepared.env.computerRef ?? undefined),
          launchKey: row.launchKey,
          scope: prepared.scope,
          argv,
          env,
          files,
          deadlineAt: prepared.deadlineAt,
          maxOutputBytes: MAX_OUTPUT_BYTES,
        }),
        15000,
      );
    } catch {
      const cleanup = await Promise.allSettled([
        releaseModel?.() ?? Promise.resolve(),
      ]);
      const joined = cleanup[0]?.status === "fulfilled";
      // Launch may have reached the computer. Persist uncertainty before any reconciliation.
      await settle(
        identity,
        launchStarted || !joined ? "uncertain" : "failed",
        !joined
          ? "tool_cleanup_unconfirmed"
          : launchStarted
            ? "launch_acknowledgement_missing"
            : "computer_or_account_unavailable",
        !launchStarted && joined,
      );
      return;
    }
    try {
      await inWorkspace(
        db,
        row.workspaceId,
        { userId: row.sponsorId },
        async (c) => {
          const current = required(
            (await c.tx.select().from(runs).where(eq(runs.id, id)))[0],
          );
          if (
            current.state !== "launching" ||
            current.attempt !== identity.attempt ||
            current.stopRequested
          )
            throw new DomainError("conflict");
          await validateRunSources(
            c,
            current,
            options.validateAutomation,
            "continue",
          );
          await c.tx
            .update(runs)
            .set({
              state: "running",
              executionRef: process.reference,
              cursor: await advanceCursor(c),
            })
            .where(eq(runs.id, id));
        },
      );
    } catch {
      await withCleanup(
        () =>
          stopProcess(
            identity,
            process,
            "authorization_revoked_before_execution",
          ),
        () =>
          withCleanup(
            () => releaseModel?.() ?? Promise.resolve(),
            () => within(process.detach()),
          ),
      );
      return;
    }
    const entry: {
      process: ComputerProcess;
      controller: AbortController;
      pi?: ReturnType<typeof connectPi>;
      promptStarted?: boolean;
      releaseModel?: () => Promise<void>;
      done: Promise<void>;
      timer?: ReturnType<typeof setTimeout>;
      stopTimer?: ReturnType<typeof setInterval>;
    } = {
      process,
      controller: new AbortController(),
      done: Promise.resolve(),
      releaseModel,
    };
    active.set(id, entry);
    let checking = false;
    entry.timer = setTimeout(
      () => {
        void stopProcess(identity, process, "deadline_exceeded").catch(
          (error: unknown) => rememberError(error),
        );
      },
      Math.max(1, prepared.deadlineAt.getTime() - Date.now()),
    );
    entry.stopTimer = setInterval(() => {
      if (checking || closing) return;
      checking = true;
      void (async () => {
        try {
          await withRunAttempt(
            db,
            identity,
            async () => {},
            options.validateAutomation,
          );
        } catch {
          await stopProcess(
            identity,
            process,
            "stopped_or_authorization_revoked",
          );
        }
      })()
        .catch((error: unknown) => rememberError(error))
        .finally(() => {
          checking = false;
        });
    }, 250);
    entry.done = withCleanup(
      async () => {
        let sequence = 0;
        try {
          if (row.type === "prompt") {
            const publish = async (
              work: (
                c: Context,
                run: typeof runs.$inferSelect,
              ) => Promise<void>,
            ) => {
              if (entry.controller.signal.aborted) return;
              let authorized = false;
              try {
                await withRunAttempt(
                  db,
                  identity,
                  (c, run) => {
                    authorized = true;
                    return work(c, run);
                  },
                  options.validateAutomation,
                );
              } catch (error) {
                // Provenance belongs to this transaction: later cancellation or
                // revocation cannot turn a publication error into an authority denial.
                if (
                  authorized ||
                  !(error instanceof DomainError) ||
                  !["forbidden", "conflict"].includes(error.code)
                )
                  throw error;
                // A current authority denial publishes nothing and requests a
                // durable Stop. Join outside this callback to avoid waiting on
                // its own Pi output chain; unknown cleanup still retains the lease.
                entry.controller.abort();
                void stopProcess(
                  identity,
                  process,
                  "authorization_revoked",
                ).catch((failure: unknown) => rememberError(failure));
              }
            };
            const pi = connectPi(process, {
              onOutput: (text) =>
                publish((c, run) => output(c, run, identity, ++sequence, text)),
              onUsage: (value) =>
                publish((c, run) => usage(c, run, identity, value)),
              handleTool: async (input, signal) => {
                await withRunAttempt(
                  db,
                  identity,
                  async () => {},
                  options.validateAutomation,
                );
                if (!options.handleTool)
                  throw new DomainError(
                    "unavailable",
                    "Scoped tools unavailable",
                  );
                return options.handleTool(
                  identity,
                  input,
                  AbortSignal.any([entry.controller.signal, signal]),
                );
              },
            });
            entry.pi = pi;
            await pi.initialize();
            const context = await inWorkspace(
              db,
              row.workspaceId,
              { userId: row.sponsorId },
              (c) => getSessionContext(c, required(row.sessionId ?? undefined)),
            );
            const nativeRef = await pi.openSession(context.contextRef, {
              provider: required(row.inputs.provider ?? undefined),
              model: row.inputs.model,
            });
            await withRunAttempt(
              db,
              identity,
              (c) =>
                bindSessionContext(
                  c,
                  required(row.sessionId ?? undefined),
                  nativeRef,
                ),
              options.validateAutomation,
            );
            const prompt = [
              row.inputs.instructions,
              row.inputs.context ? JSON.stringify(row.inputs.context) : "",
              ...row.inputs.skills.map((s) => s.instructions),
              row.inputs.body,
            ].join("\n\n");
            if (entry.controller.signal.aborted) return;
            entry.promptStarted = true;
            const reason = await pi.prompt(
              prompt,
              Math.max(1, prepared.deadlineAt.getTime() - Date.now()),
            );
            // Join the settled protocol/tool work and detach its stream before asking the remote tree to exit.
            await pi.close();
            await entry.releaseModel?.();
            // Finishing a turn is not proof its process tree is gone.
            const stopped = await stopTree(process);
            await withRunAttempt(
              db,
              identity,
              async () => {},
              options.validateAutomation,
            );
            await settle(
              identity,
              stopped
                ? reason === "finished"
                  ? "finished"
                  : reason === "failed"
                    ? "failed"
                    : "interrupted"
                : "uncertain",
              stopped ? reason : "process_stop_unconfirmed",
              stopped,
            );
          } else {
            const reader = process.stdout.getReader();
            const decoder = new TextDecoder();
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                await withRunAttempt(
                  db,
                  identity,
                  (c, run) =>
                    output(
                      c,
                      run,
                      identity,
                      ++sequence,
                      decoder.decode(chunk.value, { stream: true }),
                    ),
                  options.validateAutomation,
                );
              }
            } finally {
              await reader.cancel();
            }
            if (closing) return;
            const exitCode = await within(process.exit);
            // Root exit and stream EOF do not acknowledge descendant termination.
            const stopped = await stopTree(process);
            await withRunAttempt(
              db,
              identity,
              async () => {},
              options.validateAutomation,
            );
            await settle(
              identity,
              stopped ? (exitCode === 0 ? "finished" : "failed") : "uncertain",
              stopped ? `script_exit_${exitCode}` : "process_stop_unconfirmed",
              stopped,
            );
          }
        } catch {
          if (!closing)
            await stopProcess(identity, process, "execution_failed_or_revoked");
        }
      },
      async () => {
        clearTimeout(entry.timer);
        clearInterval(entry.stopTimer);
        try {
          await withCleanup(
            async () => {
              try {
                await entry.pi?.close();
                await entry.releaseModel?.();
              } catch (error) {
                await settle(
                  identity,
                  "uncertain",
                  "tool_cleanup_unconfirmed",
                  false,
                );
                throw error;
              }
            },
            async () => {
              await within(process.detach());
            },
          );
        } finally {
          active.delete(id);
        }
      },
    ).catch((error: unknown) => {
      rememberError(error);
    });
  }
  return {
    dispatch,
    async bind(
      workspaceId: string,
      actor: Actor,
      agentId: string,
      computerRef: string,
    ) {
      const info = await within(options.backend.inspectComputer(computerRef));
      requireComputerCapabilities(info.capabilities);
      await inWorkspace(db, workspaceId, actor, async (c) => {
        await bindEnvironment(
          c,
          agentId,
          options.backend.provider,
          computerRef,
        );
      });
      return { bound: true };
    },
    async stop(workspaceId: string, actor: Actor, id: string) {
      const row = await inWorkspace(db, workspaceId, actor, async (c) => {
        requireHuman(c);
        requireWriter(c);
        const permitted = await getRun(c, id);
        await getConversation(c, permitted.conversationId, true);
        const row = required(
          (await c.tx.select().from(runs).where(eq(runs.id, id)))[0],
        );
        await c.tx
          .update(runs)
          .set({ stopRequested: true, cursor: await advanceCursor(c) })
          .where(eq(runs.id, id));
        return row;
      });
      if (row.state === "queued") {
        await inWorkspace(db, workspaceId, actor, async (c) => {
          await c.tx
            .update(runs)
            .set({ state: "interrupted", outcome: "stopped_before_launch" })
            .where(and(eq(runs.id, id), eq(runs.state, "queued")));
        });
        return { stopped: true };
      }
      if (["finished", "failed", "interrupted"].includes(row.state))
        return { stopped: true };
      const identity = {
        runId: id,
        agentId: row.agentId,
        attempt: row.attempt,
        launchKey: row.launchKey,
      };
      const running = active.get(id);
      if (running) {
        running.controller.abort();
        let stopped = false;
        await withCleanup(
          async () => {
            // A process may be running while its private Session handshake is
            // still pending. Abort applies only after the Pi turn was submitted;
            // stopProcess closes startup work and joins the remote tree either way.
            if (running.promptStarted) await running.pi?.cancel();
          },
          async () => {
            stopped = await stopProcess(
              identity,
              running.process,
              "stopped_by_human",
            );
          },
        );
        return { stopped };
      }
      await this.reconcile(id);
      return {
        stopped: ["finished", "failed", "interrupted"].includes(
          (await descriptor(id)).state,
        ),
      };
    },
    async steer(
      workspaceId: string,
      actor: Actor,
      id: string,
      requestId: string,
      body: string,
    ) {
      if (Buffer.byteLength(body) > 16000) throw new DomainError("invalid");
      await inWorkspace(db, workspaceId, actor, async (c) => {
        requireHuman(c);
        requireWriter(c);
        const permitted = await getRun(c, id);
        await getConversation(c, permitted.conversationId, true);
        const run = required(
          (await c.tx.select().from(runs).where(eq(runs.id, id)))[0],
        );
        if (run.state !== "running") throw new DomainError("conflict");
        const prior = (
          await c.tx
            .select()
            .from(runActivity)
            .where(
              and(
                eq(runActivity.runId, id),
                eq(runActivity.requestId, requestId),
              ),
            )
        )[0];
        if (prior)
          throw new DomainError(
            "conflict",
            "Steer already recorded; delivery must not be blindly replayed",
          );
        await c.tx.insert(runActivity).values({
          workspaceId,
          runId: id,
          requestId,
          type: "steer",
          body,
          cursor: await advanceCursor(c),
        });
      });
      const pi = active.get(id)?.pi;
      if (!pi) throw new DomainError("unavailable", "Run is not attached");
      await pi.steer(body);
      return { delivered: true };
    },
    async reconcile(id: string) {
      if (active.has(id) || starting.has(id)) return;
      const row = await descriptor(id);
      if (
        row.outcome === "tool_cleanup_unconfirmed" ||
        !["launching", "running", "uncertain"].includes(row.state)
      )
        return;
      const env = await getExecutionComputer(
        db,
        row.workspaceId,
        row.agentId,
        row.id,
        row.environmentGeneration,
      );
      const identity = {
        runId: id,
        agentId: row.agentId,
        attempt: row.attempt,
        launchKey: row.launchKey,
      };
      let found: Awaited<ReturnType<ComputerBackend["lookup"]>>;
      try {
        found = await within(
          options.backend.lookup(
            required(env.computerRef ?? undefined),
            row.launchKey,
          ),
        );
      } catch {
        await settle(
          identity,
          "uncertain",
          "provider_inspection_failed",
          false,
        );
        return;
      }
      if (found.state === "exited")
        await settle(
          identity,
          found.stopped === true ? "interrupted" : "uncertain",
          found.stopped === true
            ? "recovered_process_exit_without_confirmed_result"
            : "process_stop_unconfirmed",
          found.stopped === true,
        );
      else if (found.state === "absent") {
        // Absence cannot acknowledge tree termination or exclude a launch still
        // in flight in another runtime. Keep the durable lease until stopped proof.
        await settle(
          identity,
          "uncertain",
          row.executionRef
            ? "provider_execution_unknown"
            : "launch_acknowledgement_missing",
          false,
        );
      } else if (found.state === "running") {
        await withCleanup(
          () =>
            stopProcess(
              identity,
              found.process,
              "server_restarted_context_unconfirmed",
            ),
          () => within(found.process.detach()),
        );
      } else
        await settle(
          identity,
          "uncertain",
          "provider_execution_unknown",
          false,
        );
    },
    async recover() {
      const rows = await db
        .select({ id: runs.id })
        .from(runs)
        .where(inArray(runs.state, ["launching", "running", "uncertain"]))
        .limit(1001);
      if (rows.length > 1000)
        throw new DomainError("unavailable", "Recovery limit");
      for (const row of rows) await this.reconcile(row.id);
    },
    async close() {
      closing = true;
      for (const result of await Promise.allSettled([...starting.values()]))
        if (result.status === "rejected") rememberError(result.reason);
      const closingEntries = [...active.values()];
      for (const entry of closingEntries) {
        entry.controller.abort();
        clearTimeout(entry.timer);
        clearInterval(entry.stopTimer);
        try {
          await withCleanup(
            async () => {
              await entry.pi?.close();
            },
            () => within(entry.process.detach()),
          );
        } catch (error) {
          rememberError(error);
        }
      }
      await Promise.all(closingEntries.map((entry) => entry.done));
      if (errors.length)
        throw new AggregateError(errors, "Runtime persistence/cleanup failed");
    },
    health() {
      return { active: active.size, persistenceErrors: errors.length, closing };
    },
  };
}
export type RunRuntime = ReturnType<typeof createRunRuntime>;
