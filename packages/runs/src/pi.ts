import { isDeepStrictEqual } from "node:util";
import type { ComputerProcess } from "@otto/environments";
import { DomainError } from "@otto/shared";
import { z } from "zod";
import {
  PI_BRIDGE_READY,
  PI_BRIDGE_TITLE,
  PI_FRAME_BYTES,
  PI_TOOL,
} from "./pi-extension";

const id = z.string().min(1).max(1000);
const toolName = z.enum([PI_TOOL, "read", "write", "edit", "bash"]);
const modelSchema = z.object({ provider: id, id });
const stateSchema = z.object({
  sessionId: id,
  sessionFile: id,
  model: modelSchema,
  isStreaming: z.literal(false),
  isCompacting: z.literal(false),
  pendingMessageCount: z.literal(0),
});
const assistantSchema = z.object({
  role: z.literal("assistant"),
  provider: id,
  model: id,
  responseModel: id.optional(),
  stopReason: z.enum([
    "pending",
    "stop",
    "length",
    "toolUse",
    "error",
    "aborted",
    "deferred",
  ]),
  usage: z
    .object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
      cacheRead: z.number().int().nonnegative(),
      cacheWrite: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    })
    .optional(),
});
export interface PiUsage {
  sequence: number;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
}
export interface PiHandlers {
  onOutput(text: string): Promise<void>;
  /** Server-bound Run authority; all input is untrusted. Must settle on abort. */
  handleTool(input: unknown, signal: AbortSignal): Promise<unknown>;
  onUsage?(usage: PiUsage): Promise<void>;
}
export interface PiOptions {
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  maxOutputBytes?: number;
  maxProtocolBytes?: number;
}
export type PiOutcome = "finished" | "aborted" | "failed";

/** Pinned native Pi JSONL over an already isolated process. One connection belongs to one attempt. */
export function connectPi(
  process: ComputerProcess,
  handlers: PiHandlers,
  options: PiOptions = {},
) {
  const requestTimeoutMs = options.requestTimeoutMs ?? 15000;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 5000;
  const maxOutputBytes = options.maxOutputBytes ?? 1048576;
  const maxProtocolBytes = options.maxProtocolBytes ?? 8388608;
  for (const limit of [
    requestTimeoutMs,
    cleanupTimeoutMs,
    maxOutputBytes,
    maxProtocolBytes,
  ])
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new DomainError("invalid", "Invalid Pi limit");
  let nextId = 0;
  let closed = false;
  let failure: unknown;
  let sessionId: string | undefined;
  let bridgeSessionId: string | undefined;
  let selectedModel: { provider: string; model: string } | undefined;
  let promptUsed = false;
  let active = false;
  let agentStarted = false;
  let ended = false;
  let settled = false;
  let cancelled = false;
  let outcome: PiOutcome | undefined;
  let lastStopReason: z.infer<typeof assistantSchema>["stopReason"] | undefined;
  let usageSequence = 0;
  let assistantOpen = false;
  const finalMessages: { message: Record<string, unknown>; usage: PiUsage }[] =
    [];
  let outputBytes = 0;
  let protocolBytes = 0;
  let outputCount = 0;
  let toolCount = 0;
  let outputs = Promise.resolve();
  let tools = Promise.resolve();
  let closing: Promise<void> | undefined;
  let cancellation: Promise<void> | undefined;
  let completion:
    | { resolve(value: PiOutcome): void; reject(error: unknown): void }
    | undefined;
  const controller = new AbortController();
  const reader = process.stdout.getReader();
  const pending = new Map<
    string,
    {
      command: string;
      resolve(value: unknown): void;
      reject(error: unknown): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const nativeTools = new Map<
    string,
    {
      name: z.infer<typeof toolName>;
      input: unknown;
      bridged: boolean;
      responded: boolean;
      controller: AbortController;
    }
  >();
  const seenTools = new Set<string>();
  const seenDialogs = new Set<string>();
  const writes = new Set<Promise<void>>();
  const unavailable = (message: string) =>
    new DomainError("unavailable", message);
  const within = async <T>(
    work: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(unavailable(message)), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const fail = (error: unknown) => {
    failure ??= error;
    closed = true;
    controller.abort(failure);
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(failure);
    }
    pending.clear();
    completion?.reject(failure);
  };
  // Observe detached exit failures; process-tree termination remains the runtime's responsibility.
  void process.exit.catch(fail);
  const send = async (message: object) => {
    if (closed) throw failure ?? unavailable("Pi closed");
    const bytes = new TextEncoder().encode(`${JSON.stringify(message)}\n`);
    if (bytes.byteLength > PI_FRAME_BYTES) throw unavailable("Pi frame limit");
    if (writes.size >= 16) throw unavailable("Pi write backlog limit");
    const writing = Promise.resolve().then(() => process.write(bytes));
    writes.add(writing);
    void writing.then(
      () => {
        writes.delete(writing);
      },
      (error: unknown) => {
        writes.delete(writing);
        fail(error);
      },
    );
    await within(
      writing,
      cleanupTimeoutMs,
      "Pi write timeout; cleanup uncertain",
    );
  };
  async function request(command: string, params: object = {}) {
    if (closed || pending.size >= 8)
      throw failure ?? unavailable("Pi closed or busy");
    const requestId = String(++nextId);
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => fail(unavailable("Pi request timeout; cleanup uncertain")),
        requestTimeoutMs,
      );
      pending.set(requestId, { command, resolve, reject, timer });
    });
    void result.catch(() => {});
    try {
      await send({ type: command, id: requestId, ...params });
    } catch (error) {
      fail(error);
    }
    return result;
  }
  const queueOutput = (work: () => Promise<void>) => {
    if (++outputCount > 128) throw unavailable("Pi output backlog limit");
    outputs = outputs
      .then(work)
      .catch(fail)
      .finally(() => {
        outputCount--;
      });
  };
  const join = async () => {
    await within(
      Promise.all([tools, outputs, ...writes]),
      cleanupTimeoutMs,
      "Pi callback cleanup timeout; retain uncertainty",
    );
    if (failure) throw failure;
  };
  const verifyModel = (
    provider: string,
    model: string,
    responseModel?: string,
  ) => {
    if (
      !selectedModel ||
      selectedModel.provider !== provider ||
      selectedModel.model !== model ||
      (responseModel !== undefined && responseModel !== model)
    )
      throw new DomainError("forbidden", "Pi model changed; no fallback");
  };
  const finish = () => {
    const terminal = cancelled ? "aborted" : outcome;
    if (assistantOpen || !ended || !terminal)
      throw unavailable("Pi settled without terminal outcome");
    if (nativeTools.size)
      throw unavailable("Pi settled with native tools running");
    settled = true;
    void join()
      .then(() => {
        active = false;
        completion?.resolve(cancelled ? "aborted" : terminal);
      })
      .catch(fail);
  };
  const dispatch = (input: unknown) => {
    const message = z.object({ type: id }).passthrough().parse(input);
    if (message.type === "response") {
      const response = z
        .object({
          id,
          command: id,
          success: z.boolean(),
          data: z.unknown().optional(),
          error: z.string().optional(),
        })
        .parse(message);
      const item = pending.get(response.id);
      if (!item || item.command !== response.command)
        throw unavailable("Uncorrelated Pi response");
      pending.delete(response.id);
      clearTimeout(item.timer);
      if (response.success) item.resolve(response.data);
      else {
        const error = unavailable(
          "Pi command failed; no account/model fallback",
        );
        item.reject(error);
        fail(error);
      }
      return;
    }
    if (message.type === "extension_error")
      throw unavailable("Managed Pi extension failed");
    if (message.type === "extension_ui_request") {
      const dialog = z
        .object({
          id,
          method: id,
          title: z.string().optional(),
          placeholder: z.string().optional(),
          message: z.string().optional(),
        })
        .parse(message);
      if (dialog.method === "notify") {
        const ready = z
          .object({ bridge: z.literal(PI_BRIDGE_READY), sessionId: id })
          .parse(JSON.parse(dialog.message ?? ""));
        if (active) throw unavailable("Pi Session changed during attempt");
        bridgeSessionId = ready.sessionId;
        return;
      }
      if (
        !active ||
        settled ||
        dialog.method !== "input" ||
        dialog.title !== PI_BRIDGE_TITLE
      )
        throw unavailable("Unsupported Pi extension UI request");
      if (
        seenDialogs.has(dialog.id) ||
        seenDialogs.size >= 1024 ||
        toolCount >= 8
      )
        throw unavailable("Pi tool correlation or backlog limit");
      const call = z
        .object({ sessionId: id, toolCallId: id, input: z.unknown() })
        .parse(JSON.parse(dialog.placeholder ?? ""));
      const tool = nativeTools.get(call.toolCallId);
      if (
        call.sessionId !== sessionId ||
        !tool ||
        tool.name !== PI_TOOL ||
        tool.bridged ||
        JSON.stringify(tool.input) !== JSON.stringify(call.input)
      )
        throw new DomainError("forbidden", "Wrong Pi Session or tool call");
      seenDialogs.add(dialog.id);
      const signal = AbortSignal.any([
        controller.signal,
        tool.controller.signal,
      ]);
      tool.bridged = true;
      toolCount++;
      tools = tools
        .then(async () => {
          if (signal.aborted) return;
          let response: object;
          try {
            response = {
              success: true,
              result: (await handlers.handleTool(call.input, signal)) ?? null,
            };
          } catch (error) {
            if (signal.aborted) return;
            // Domain denials are native tool errors; implementation failures remain observable.
            if (!(error instanceof DomainError)) throw error;
            response = { success: false };
          }
          if (!signal.aborted) {
            const value = JSON.stringify(response);
            if (new TextEncoder().encode(value).byteLength > PI_FRAME_BYTES / 2)
              throw unavailable("Pi tool result limit");
            tool.responded = true;
            await send({ type: "extension_ui_response", id: dialog.id, value });
          }
        })
        .catch(fail)
        .finally(() => {
          toolCount--;
        });
      return;
    }
    if (!active || settled) throw unavailable("Pi event outside active prompt");
    switch (message.type) {
      case "agent_start":
        if (agentStarted && !ended)
          throw unavailable("Duplicate Pi agent_start");
        agentStarted = true;
        ended = false;
        outcome = undefined;
        lastStopReason = undefined;
        break;
      case "message_start": {
        const start = z
          .object({ message: z.object({ role: id }).passthrough() })
          .parse(message);
        if (start.message.role === "assistant") {
          if (assistantOpen)
            throw unavailable("Duplicate Pi assistant message");
          if (usageSequence >= 1024)
            throw unavailable("Pi assistant message limit");
          usageSequence++;
          assistantOpen = true;
          const assistant = assistantSchema.parse(start.message);
          verifyModel(
            assistant.provider,
            assistant.model,
            assistant.responseModel,
          );
        }
        break;
      }
      case "message_update": {
        if (!assistantOpen)
          throw unavailable("Pi update outside assistant message");
        const update = z
          .object({
            usage: z.unknown().optional(),
            assistantMessageEvent: z.object({
              type: z.enum([
                "text_start",
                "text_delta",
                "text_end",
                "thinking_start",
                "thinking_delta",
                "thinking_end",
                "toolcall_start",
                "toolcall_delta",
                "toolcall_end",
              ]),
              delta: z.string().optional(),
            }),
          })
          .parse(message);
        if (update.assistantMessageEvent.type === "text_delta") {
          const text = z.string().parse(update.assistantMessageEvent.delta);
          outputBytes += new TextEncoder().encode(text).byteLength;
          if (outputBytes > maxOutputBytes)
            throw unavailable("Pi output limit");
          queueOutput(() => handlers.onOutput(text));
        }
        break;
      }
      case "message_end": {
        const end = z
          .object({ message: z.object({ role: id }).passthrough() })
          .parse(message);
        if (end.message.role !== "assistant") break;
        if (!assistantOpen) {
          const replay = finalMessages.find((final) =>
            isDeepStrictEqual(final.message, end.message),
          );
          if (!replay)
            throw unavailable(
              "Pi final replay conflict or end outside assistant message",
            );
          if (handlers.onUsage)
            queueOutput(
              () => handlers.onUsage?.(replay.usage) ?? Promise.resolve(),
            );
          break;
        }
        assistantOpen = false;
        const assistant = assistantSchema.parse(end.message);
        verifyModel(
          assistant.provider,
          assistant.model,
          assistant.responseModel,
        );
        if (
          assistant.stopReason === "pending" ||
          assistant.stopReason === "deferred"
        )
          throw unavailable("Unsupported Pi final response");
        lastStopReason = assistant.stopReason;
        const usage: PiUsage = {
          sequence: usageSequence,
          provider: assistant.provider,
          model: assistant.model,
          inputTokens: assistant.usage?.input ?? null,
          outputTokens: assistant.usage?.output ?? null,
          cacheReadTokens: assistant.usage?.cacheRead ?? null,
          cacheWriteTokens: assistant.usage?.cacheWrite ?? null,
          totalTokens: assistant.usage?.totalTokens ?? null,
        };
        finalMessages.push({ message: end.message, usage });
        if (handlers.onUsage)
          queueOutput(() => handlers.onUsage?.(usage) ?? Promise.resolve());
        break;
      }
      case "tool_execution_start": {
        const tool = z
          .object({
            toolCallId: id,
            toolName,
            args: z.unknown(),
            parentToolCallId: z.never().optional(),
          })
          .parse(message);
        if (
          nativeTools.size >= 8 ||
          seenTools.size >= 1024 ||
          seenTools.has(tool.toolCallId)
        )
          throw unavailable("Pi native tool limit or duplicate");
        seenTools.add(tool.toolCallId);
        nativeTools.set(tool.toolCallId, {
          name: tool.toolName,
          input:
            tool.toolName === PI_TOOL
              ? z.object({ input: z.unknown() }).parse(tool.args).input
              : undefined,
          bridged: false,
          responded: false,
          controller: new AbortController(),
        });
        break;
      }
      case "tool_execution_update":
      case "tool_execution_end": {
        const tool = z
          .object({
            toolCallId: id,
            toolName,
            parentToolCallId: z.never().optional(),
          })
          .parse(message);
        if (nativeTools.get(tool.toolCallId)?.name !== tool.toolName)
          throw unavailable("Uncorrelated Pi tool event");
        if (message.type === "tool_execution_end") {
          const accepted = nativeTools.get(tool.toolCallId);
          if (accepted && !accepted.responded)
            accepted.controller.abort(
              unavailable("Pi tool ended before server reply"),
            );
          nativeTools.delete(tool.toolCallId);
        }
        break;
      }
      case "agent_end": {
        z.object({
          messages: z.array(z.unknown()),
          willRetry: z.boolean(),
        }).parse(message);
        if (!agentStarted || ended)
          throw unavailable("Uncorrelated Pi agent_end");
        ended = true;
        outcome =
          cancelled || lastStopReason === "aborted"
            ? "aborted"
            : lastStopReason === "stop"
              ? "finished"
              : lastStopReason === "length" || lastStopReason === "error"
                ? "failed"
                : undefined;
        break;
      }
      case "agent_settled":
        finish();
        break;
      // Private transcript, tool traces and compaction/retry details are never published.
      case "turn_start":
      case "turn_end":
      case "queue_update":
      case "entry_appended":
      case "compaction_start":
      case "compaction_end":
      case "auto_retry_start":
      case "auto_retry_end":
        break;
      default:
        throw unavailable("Unsupported Pi event");
    }
  };
  const reading = (async () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let line = "";
    let lineBytes = 0;
    try {
      while (!closed) {
        const chunk = await reader.read();
        if (chunk.done) {
          if (!closed)
            throw unavailable(
              lineBytes
                ? "Truncated Pi frame"
                : "Pi stream closed; cleanup uncertain",
            );
          break;
        }
        protocolBytes += chunk.value.byteLength;
        if (protocolBytes > maxProtocolBytes)
          throw unavailable("Pi protocol output limit");
        let offset = 0;
        while (offset < chunk.value.length && !closed) {
          const newline = chunk.value.indexOf(10, offset);
          const end = newline === -1 ? chunk.value.length : newline;
          const bytes = chunk.value.subarray(offset, end);
          lineBytes += bytes.byteLength;
          if (lineBytes > PI_FRAME_BYTES) throw unavailable("Pi frame limit");
          line += decoder.decode(bytes, { stream: true });
          if (newline === -1) break;
          line += decoder.decode();
          if (line.trim()) dispatch(JSON.parse(line));
          line = "";
          lineBytes = 0;
          offset = end + 1;
        }
      }
    } catch (error) {
      fail(error);
    }
  })();
  const externalAbort = () => {
    void cancel().catch(fail);
  };
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  if (options.signal?.aborted) externalAbort();
  async function cancel() {
    cancellation ??= (async () => {
      cancelled = true;
      controller.abort(unavailable("Pi cancelled"));
      await within(
        (async () => {
          if (!closed) await request("abort");
          await join();
        })(),
        cleanupTimeoutMs,
        "Pi cancellation timeout; retain uncertainty",
      );
    })().catch((error: unknown) => {
      fail(error);
      throw error;
    });
    return cancellation;
  }
  return {
    async initialize() {
      return stateSchema.parse(await request("get_state"));
    },
    async openSession(
      contextRef: string | null,
      model: { provider: string; model: string },
    ) {
      if (promptUsed || active || controller.signal.aborted)
        throw unavailable("Pi Session already in use");
      id.parse(model.provider);
      id.parse(model.model);
      if (contextRef !== null) {
        id.parse(contextRef);
        const switched = z
          .object({ cancelled: z.literal(false) })
          .parse(await request("switch_session", { sessionPath: contextRef }));
        void switched;
      }
      const state = stateSchema.parse(await request("get_state"));
      if (contextRef !== null && state.sessionFile !== contextRef)
        throw new DomainError(
          "forbidden",
          "Wrong private Pi Session reference",
        );
      if (bridgeSessionId !== state.sessionId)
        throw unavailable("Managed Pi tool bridge missing or wrong Session");
      selectedModel = model;
      verifyModel(state.model.provider, state.model.id);
      sessionId = state.sessionId;
      return state.sessionFile;
    },
    async prompt(text: string, timeoutMs: number): Promise<PiOutcome> {
      if (
        !sessionId ||
        controller.signal.aborted ||
        promptUsed ||
        closed ||
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1
      )
        throw failure ?? unavailable("Pi prompt not ready");
      if (text.trimStart().startsWith("/"))
        throw new DomainError(
          "forbidden",
          "Pi commands are not managed prompts",
        );
      promptUsed = true;
      active = true;
      const done = new Promise<PiOutcome>((resolve, reject) => {
        completion = { resolve, reject };
      });
      void done.catch(() => {});
      try {
        const work = (async () => {
          const ack = z
            .object({ disposition: z.literal("started") })
            .parse(await request("prompt", { message: text }));
          void ack;
          return await done;
        })();
        return await within(
          work,
          timeoutMs,
          "Pi prompt timeout; cleanup uncertain",
        );
      } catch (error) {
        if (!closed) fail(error);
        throw error;
      }
    },
    async steer(text: string) {
      if (!active || settled || cancelled || text.trimStart().startsWith("/"))
        throw unavailable("Pi steering unavailable");
      z.object({ disposition: z.literal("queued") }).parse(
        await request("steer", { message: text }),
      );
    },
    cancel,
    close() {
      closing ??= (async () => {
        options.signal?.removeEventListener("abort", externalAbort);
        closed = true;
        controller.abort(unavailable("Pi detached"));
        for (const item of pending.values()) {
          clearTimeout(item.timer);
          item.reject(failure ?? unavailable("Pi detached"));
        }
        pending.clear();
        completion?.reject(failure ?? unavailable("Pi detached"));
        await within(
          Promise.all([reader.cancel(), reading, join()]),
          cleanupTimeoutMs,
          "Pi close timeout; retain uncertainty",
        );
        if (failure) throw failure;
      })();
      return closing;
    },
  };
}
