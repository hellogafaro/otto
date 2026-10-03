import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import type { Database } from "@otto/db";
import type { ModelConfig } from "@otto/runs";
import { type Attempt, withRunAttempt } from "@otto/runs/runtime";
import { DomainError, required } from "@otto/shared";
import { z } from "zod";
import { privateEndpoint, readServiceJson } from "./service-http";
import type { SubscriptionLogin } from "./subscription-login";

/** One private CLIProxyAPI route. Otto, not the caller key, owns account/model/attempt authority. */
export function createModelGateway(
  db: Database,
  options: {
    endpoint: string;
    key: string;
    origin: string;
    accounts: SubscriptionLogin;
    allowLoopbackHttp?: boolean;
    modelConfig?: Readonly<Record<string, ModelConfig>>;
  },
) {
  const endpoint = privateEndpoint(options.endpoint, options.allowLoopbackHttp);
  const capabilities = new Map<
    string,
    { attempt: Attempt; expiresAt: number }
  >();
  const active = new Map<
    AbortController,
    { token: string; done: Promise<void> }
  >();
  let closing = false;
  let closePromise: Promise<void> | undefined;
  async function join(requests: Promise<void>[]) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(requests),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new DomainError(
                  "unavailable",
                  "Model request cleanup unconfirmed",
                ),
              ),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const catalog = openaiCodexProvider().getModels();
  function modelConfig(id: string): ModelConfig | undefined {
    const configured = options.modelConfig?.[id];
    const pinned = catalog.find((model) => model.id === id);
    const value =
      configured ??
      (pinned
        ? {
            contextWindow: pinned.contextWindow,
            maxTokens: pinned.maxTokens,
            reasoning: pinned.reasoning,
            input: pinned.input,
          }
        : undefined);
    if (!value) return undefined;
    return z
      .object({
        contextWindow: z.number().int().min(1).max(10000000),
        maxTokens: z.number().int().min(1).max(10000000),
        reasoning: z.boolean(),
        input: z
          .array(z.enum(["text", "image"]))
          .min(1)
          .max(2),
      })
      .parse(value);
  }
  async function authorize(attempt: Attempt) {
    return withRunAttempt(db, attempt, async (_c, run) => ({
      subscriptionId: required(
        run.inputs.subscriptionId ?? undefined,
        "forbidden",
      ),
      accountId: required(run.inputs.accountId ?? undefined, "forbidden"),
      provider: required(run.inputs.provider ?? undefined, "forbidden"),
      model: run.inputs.model,
      sessionId: required(run.sessionId ?? undefined, "forbidden"),
      deadlineAt: required(run.deadlineAt ?? undefined, "forbidden"),
    }));
  }
  function headers(
    subscriptionId: string,
    accountId: string,
    model: string,
    attemptId: string,
    sessionId?: string,
  ) {
    return {
      authorization: `Bearer ${options.key}`,
      "content-type": "application/json",
      "X-Otto-Subscription-Id": subscriptionId,
      "X-Otto-Account-Id": accountId,
      "X-Otto-Model": model,
      "X-Otto-Attempt-Id": attemptId,
      ...(sessionId ? { "X-Otto-Session-Id": sessionId } : {}),
    };
  }
  async function models(
    subscriptionId: string,
    model: string,
    signal: AbortSignal,
  ) {
    const account = await options.accounts.read(subscriptionId, signal);
    const response = await fetch(new URL("/otto/v1/models", endpoint), {
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      headers: headers(
        subscriptionId,
        account.credential.accountId,
        model,
        crypto.randomUUID(),
      ),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DomainError("unavailable", "Account models unavailable");
    }
    const result = z
      .object({
        data: z.array(z.object({ id: z.string().min(1).max(256) })).max(1000),
      })
      .parse(await readServiceJson(response));
    const after = await options.accounts.read(subscriptionId, signal);
    if (
      after.credential.accountId !== account.credential.accountId ||
      after.authenticatedAt !== account.authenticatedAt
    )
      throw new DomainError("forbidden", "Account authentication changed");
    return {
      accountId: account.credential.accountId,
      models: result.data.filter((item) => modelConfig(item.id)),
    };
  }
  return {
    async authorizeModel(subscriptionId: string, model: string) {
      const result = await models(
        subscriptionId,
        model,
        new AbortController().signal,
      );
      if (!result.models.some((item) => item.id === model))
        throw new DomainError(
          "forbidden",
          "Model unavailable for selected account",
        );
      return {
        accountId: result.accountId,
        modelConfig: required(modelConfig(model), "unavailable"),
      };
    },
    async getModels(subscriptionId: string, signal: AbortSignal) {
      return (await models(subscriptionId, "", signal)).models;
    },
    async issue(attempt: Attempt) {
      for (const [key, value] of capabilities)
        if (value.expiresAt <= Date.now()) capabilities.delete(key);
      if (closing || capabilities.size >= 64)
        throw new DomainError("unavailable", "Model access capacity");
      // Trusted runtime calls this after durable launch identity, before remote I/O. Every use separately proves running authority.
      const token = crypto.randomUUID() + crypto.randomUUID();
      capabilities.set(token, {
        attempt: { ...attempt },
        expiresAt: Date.now() + 3600000,
      });
      let released: Promise<void> | undefined;
      return {
        baseUrl: new URL("/model/v1", options.origin).href,
        token,
        release() {
          released ??= (async () => {
            capabilities.delete(token);
            const pending: Promise<void>[] = [];
            for (const [controller, request] of active)
              if (request.token === token) {
                controller.abort();
                pending.push(request.done);
              }
            await join(pending);
          })();
          return released;
        },
      };
    },
    async handle(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (
        !(
          (request.method === "POST" && path === "/model/v1/responses") ||
          (request.method === "GET" && path === "/model/v1/models")
        )
      )
        throw new DomainError("not_found");
      const token = request.headers
        .get("authorization")
        ?.replace(/^Bearer /, "");
      const capability = token ? capabilities.get(token) : undefined;
      if (closing || !capability || capability.expiresAt <= Date.now())
        throw new DomainError("forbidden");
      if (active.size >= 16)
        throw new DomainError("unavailable", "Model request capacity");
      const controller = new AbortController();
      let joined: () => void = () => {};
      let cleanupFailed: (error: unknown) => void = () => {};
      const done = new Promise<void>((resolve, reject) => {
        joined = resolve;
        cleanupFailed = reject;
      });
      void done.catch(() => {});
      active.set(controller, { token: required(token, "forbidden"), done });
      let handedOff = false;
      try {
        const accepted = await authorize(capability.attempt);
        if (
          closing ||
          controller.signal.aborted ||
          accepted.provider !== "codex"
        )
          throw new DomainError("forbidden");
        const signal = AbortSignal.any([
          controller.signal,
          request.signal,
          AbortSignal.timeout(
            Math.max(1, accepted.deadlineAt.getTime() - Date.now()),
          ),
        ]);
        let body: string | undefined;
        if (request.method === "POST") {
          let value: unknown;
          try {
            value = await readServiceJson(new Response(request.body), 1048576);
          } catch {
            throw new DomainError("invalid", "Invalid model request");
          }
          const input = z
            .object({
              model: z.literal(accepted.model),
              stream: z.boolean().optional(),
              prompt_cache_key: z.string().min(1).max(64).optional(),
            })
            .passthrough()
            .parse(value);
          body = JSON.stringify({
            ...input,
            ...(input.prompt_cache_key !== undefined
              ? { prompt_cache_key: accepted.sessionId }
              : {}),
          });
          if (Buffer.byteLength(body) > 1048576)
            throw new DomainError("invalid", "Model input limit");
        }
        const account = await options.accounts.read(
          accepted.subscriptionId,
          signal,
        );
        if (account.credential.accountId !== accepted.accountId)
          throw new DomainError("forbidden", "Accepted account changed");
        await authorize(capability.attempt);
        const response = await fetch(
          new URL(
            request.method === "GET" ? "/otto/v1/models" : "/otto/v1/responses",
            endpoint,
          ),
          {
            method: request.method,
            redirect: "error",
            signal,
            body,
            headers: headers(
              accepted.subscriptionId,
              accepted.accountId,
              accepted.model,
              `${capability.attempt.runId}-${capability.attempt.attempt}-${capability.attempt.launchKey}`,
              accepted.sessionId,
            ),
          },
        );
        await authorize(capability.attempt);
        if (!response.ok) {
          await response.body?.cancel();
          // Do not expose upstream account inventory, credentials or error bodies.
          return Response.json(
            {
              error:
                response.status === 429
                  ? "account_unavailable"
                  : "model_unavailable",
            },
            { status: response.status === 429 ? 429 : 503 },
          );
        }
        if (request.method === "GET") {
          const result = z
            .object({ data: z.array(z.object({ id: z.string() })).max(1000) })
            .parse(await readServiceJson(response));
          await authorize(capability.attempt);
          return Response.json({
            object: "list",
            data: result.data
              .filter((item) => item.id === accepted.model)
              .map((item) => ({ id: item.id, object: "model" })),
          });
        }
        const reader = required(response.body?.getReader(), "unavailable");
        // Observe the actual fetch reader's terminal state before cleanup. On
        // abort, cancel() repeats its stored stream error rather than doing I/O.
        const terminal = reader.closed.then(
          () => ({ type: "closed" as const }),
          (error: unknown) => ({ type: "errored" as const, error }),
        );
        let byteCount = 0;
        handedOff = true;
        const output = new ReadableStream<Uint8Array>({
          start(stream) {
            void (async () => {
              try {
                while (true) {
                  const chunk = await reader.read();
                  if (chunk.done) break;
                  byteCount += chunk.value.byteLength;
                  if (byteCount > 8388608 || signal.aborted)
                    throw new DomainError("unavailable", "Model stream limit");
                  await authorize(capability.attempt);
                  stream.enqueue(chunk.value);
                }
                await authorize(capability.attempt);
                stream.close();
              } catch {
                controller.abort();
                stream.error(
                  new DomainError("unavailable", "Model stream unavailable"),
                );
              } finally {
                let confirmed = false;
                try {
                  await reader.cancel();
                  confirmed = true;
                } catch (error) {
                  const state = await terminal;
                  confirmed =
                    signal.aborted &&
                    state.type === "errored" &&
                    state.error === error;
                  if (!confirmed) {
                    controller.abort();
                    cleanupFailed(
                      new DomainError(
                        "unavailable",
                        "Model request cleanup unconfirmed",
                      ),
                    );
                  }
                } finally {
                  reader.releaseLock();
                  if (confirmed) {
                    active.delete(controller);
                    joined();
                  }
                }
              }
            })();
          },
          cancel() {
            controller.abort();
            return done;
          },
        });
        return new Response(output, {
          headers: {
            "content-type": response.headers
              .get("content-type")
              ?.startsWith("text/event-stream")
              ? "text/event-stream"
              : "application/json",
            "cache-control": "no-store",
          },
        });
      } finally {
        if (!handedOff) {
          controller.abort();
          active.delete(controller);
          joined();
        }
      }
    },
    async isReady() {
      if (closing) return false;
      try {
        const response = await fetch(new URL("/otto/ready", endpoint), {
          headers: { authorization: `Bearer ${options.key}` },
          redirect: "error",
          signal: AbortSignal.timeout(3000),
        });
        await response.body?.cancel();
        return response.status === 204 && !closing;
      } catch {
        return false;
      }
    },
    async close() {
      closing = true;
      capabilities.clear();
      for (const controller of active.keys()) controller.abort();
      closePromise ??= join(
        [...active.values()].map((request) => request.done),
      );
      return closePromise;
    },
  };
}
export type ModelGateway = ReturnType<typeof createModelGateway>;
