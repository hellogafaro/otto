import type { ComputerProcess } from "@otto/environments";
import { DomainError } from "@otto/shared";

import { z } from "zod";

const envelope = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
const initResult = z.object({
  protocolVersion: z.literal(1),
  agentCapabilities: z
    .object({
      loadSession: z.boolean().optional(),
      _meta: z
        .object({
          ottoTools: z.boolean().optional(),
          ottoSteer: z.boolean().optional(),
        })
        .optional(),
    })
    .passthrough(),
});
const configValue = z.object({ value: z.string().max(1000) });
const configOption = z.object({
  id: z.string().max(1000),
  category: z.string().optional(),
  type: z.string(),
  currentValue: z.union([z.string(), z.boolean()]),
  options: z
    .array(
      z.union([
        configValue,
        z.object({ options: z.array(configValue).max(128) }),
      ]),
    )
    .max(128)
    .optional(),
});
const sessionConfig = z.object({
  configOptions: z.array(configOption).max(128).optional(),
});
export interface AcpHandlers {
  onOutput(text: string): Promise<void>;
  /** Must settle when aborted; close joins accepted tool work. */
  handleTool(input: unknown, signal: AbortSignal): Promise<unknown>;
}
/** ACP v1 JSON-RPC over an already isolated process. No subprocess creation or native login occurs here. */
export function connectAcp(process: ComputerProcess, handlers: AcpHandlers) {
  let nextId = 0;
  let closed = false;
  let streaming = false;
  let selectedModel: { id: string; value: string } | undefined;
  let sessionId: string | undefined;
  let capabilities: z.infer<typeof initResult>["agentCapabilities"] = {};
  const pending = new Map<
    string | number,
    {
      resolve(value: unknown): void;
      reject(error: unknown): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const controller = new AbortController();
  let toolCount = 0;
  let tools = Promise.resolve();
  let toolError: unknown;
  let closing: Promise<void> | undefined;
  const send = async (message: unknown) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        process.write(new TextEncoder().encode(`${JSON.stringify(message)}\n`)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new DomainError("unavailable", "ACP write timeout")),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const rejectPending = (error: unknown) => {
    closed = true;
    controller.abort(error);
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  const joinTools = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        tools,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new DomainError("unavailable", "ACP tool cleanup timeout"),
              ),
            5000,
          );
        }),
      ]);
      if (toolError) throw toolError;
    } finally {
      clearTimeout(timer);
    }
  };
  const reader = process.stdout.getReader();
  const reading = (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!closed) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (Buffer.byteLength(buffer) > 262144)
          throw new DomainError("unavailable", "ACP frame limit");
        let newline = buffer.indexOf("\n");
        while (newline !== -1 && !closed) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line.trim()) continue;
          const message = envelope.parse(JSON.parse(line));
          if (message.method) {
            if (message.method === "session/update") {
              const update = z
                .object({
                  sessionId: z.string(),
                  update: z.object({
                    sessionUpdate: z.string(),
                    configOptions: z.array(configOption).max(128).optional(),
                    content: z
                      .object({ type: z.string(), text: z.string().optional() })
                      .optional(),
                  }),
                })
                .parse(message.params);
              if (update.sessionId !== sessionId)
                throw new DomainError("forbidden", "Wrong native Session");
              if (
                selectedModel &&
                update.update.sessionUpdate === "config_option_update"
              ) {
                const model = update.update.configOptions?.find(
                  (o) => o.id === selectedModel?.id,
                );
                if (!model || model.currentValue !== selectedModel.value)
                  throw new DomainError(
                    "forbidden",
                    "Native model changed; no fallback",
                  );
              }
              // Thought chunks and raw tool traces are private, never shared messages.
              if (
                streaming &&
                update.update.sessionUpdate === "agent_message_chunk" &&
                update.update.content?.type === "text"
              )
                await handlers.onOutput(update.update.content.text ?? "");
            } else if (message.id !== undefined) {
              if (toolCount >= 8)
                throw new DomainError("unavailable", "ACP tool limit");
              // Keep tool execution/replies ordered without blocking control responses.
              // Bound queued work as well as the one running callback.
              toolCount++;
              const allowed = streaming && capabilities._meta?.ottoTools;
              tools = tools
                .then(async () => {
                  if (controller.signal.aborted) return;
                  let response: object;
                  try {
                    let result: unknown;
                    if (allowed && message.method === "_otto/tool") {
                      const request = z
                        .object({ sessionId: z.string(), input: z.unknown() })
                        .parse(message.params);
                      if (request.sessionId !== sessionId)
                        throw new DomainError("forbidden");
                      result = await handlers.handleTool(
                        request.input,
                        controller.signal,
                      );
                    } else if (
                      message.method === "session/request_permission"
                    ) {
                      // No blanket harness permission: use scoped Otto tools.
                      result = { outcome: { outcome: "cancelled" } };
                    } else
                      throw new DomainError(
                        "unavailable",
                        "Unsupported client method",
                      );
                    response = { jsonrpc: "2.0", id: message.id, result };
                  } catch {
                    response = {
                      jsonrpc: "2.0",
                      id: message.id,
                      error: {
                        code: -32603,
                        message: "Otto operation denied or unavailable",
                      },
                    };
                  }
                  if (!controller.signal.aborted) await send(response);
                })
                .catch((error: unknown) => {
                  toolError = error;
                  rejectPending(error);
                })
                .finally(() => {
                  toolCount--;
                });
            }
          } else if (message.id !== undefined) {
            const item = pending.get(message.id);
            if (!item) continue;
            pending.delete(message.id);
            clearTimeout(item.timer);
            if (message.error)
              item.reject(
                new DomainError(
                  "unavailable",
                  "Native harness request failed; no auth/billing fallback",
                ),
              );
            else item.resolve(message.result);
          }
        }
      }
      if (!closed)
        rejectPending(new DomainError("unavailable", "ACP stream closed"));
    } catch (error) {
      rejectPending(error);
    }
  })();
  async function request(
    method: string,
    params: unknown,
    timeoutMs = 15000,
  ): Promise<unknown> {
    if (closed || pending.size >= 8)
      throw new DomainError("unavailable", "ACP closed or busy");
    const id = ++nextId;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new DomainError("unavailable", "ACP request timeout"));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
    // Attach a rejection handler before any asynchronous write can fail.
    void result.catch(() => {});
    try {
      await send({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      rejectPending(error);
    }
    return result;
  }
  return {
    async initialize() {
      const result = initResult.parse(
        await request("initialize", {
          protocolVersion: 1,
          clientInfo: { name: "otto", version: "0.0.1" },
          clientCapabilities: { _meta: { ottoTools: true } },
        }),
      );
      capabilities = result.agentCapabilities;
      return capabilities;
    },
    async openSession(contextRef: string | null, model: string) {
      let config: z.infer<typeof sessionConfig>;
      if (contextRef) {
        if (!capabilities.loadSession)
          throw new DomainError(
            "unavailable",
            "Harness cannot load retained Session",
          );
        sessionId = contextRef;
        config = sessionConfig.parse(
          await request("session/load", {
            sessionId,
            cwd: "/workspace",
            mcpServers: [],
          }),
        );
      } else {
        const result = z
          .object({
            sessionId: z.string().min(1).max(1000),
            configOptions: z.array(configOption).max(128).optional(),
          })
          .parse(
            await request("session/new", { cwd: "/workspace", mcpServers: [] }),
          );
        sessionId = result.sessionId;
        config = result;
      }
      const option = config.configOptions?.find(
        (o) => o.category === "model" && o.type === "select",
      );
      const values = option?.options?.flatMap((o) =>
        "value" in o ? [o.value] : o.options.map((v) => v.value),
      );
      if (!option || !values?.includes(model))
        throw new DomainError(
          "unavailable",
          "Harness cannot select requested model",
        );
      selectedModel = { id: option.id, value: model };
      if (option.currentValue !== model) {
        const changed = sessionConfig.parse(
          await request("session/set_config_option", {
            sessionId,
            configId: option.id,
            value: model,
          }),
        );
        if (
          changed.configOptions?.find((o) => o.id === option.id)
            ?.currentValue !== model
        )
          throw new DomainError("forbidden", "Requested model not confirmed");
      }
      return sessionId;
    },
    async prompt(text: string, timeoutMs: number) {
      streaming = true;
      try {
        const result = z
          .object({ stopReason: z.string() })
          .parse(
            await request(
              "session/prompt",
              { sessionId, prompt: [{ type: "text", text }] },
              timeoutMs,
            ),
          );
        return result.stopReason;
      } finally {
        streaming = false;
        // One ACP connection belongs to one attempt. A native completion must
        // not release that attempt while trusted tool work is still running.
        controller.abort(new DomainError("unavailable", "ACP prompt ended"));
        await joinTools();
      }
    },
    async steer(text: string) {
      if (!capabilities._meta?.ottoSteer)
        throw new DomainError(
          "unavailable",
          "Harness does not support steering",
        );
      await request("_otto/steer", { sessionId, text });
    },
    async cancel() {
      controller.abort(new DomainError("unavailable", "ACP cancelled"));
      if (sessionId)
        await send({
          jsonrpc: "2.0",
          method: "session/cancel",
          params: { sessionId },
        });
    },
    close() {
      closing ??= (async () => {
        rejectPending(new DomainError("unavailable", "ACP detached"));
        await Promise.all([reader.cancel(), reading, joinTools()]);
      })();
      return closing;
    },
  };
}
