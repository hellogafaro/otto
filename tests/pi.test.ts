import { expect, test, vi } from "vitest";
import type { ComputerProcess } from "../packages/environments/src/computer";
import {
  connectPi,
  type PiOptions,
  type PiUsage,
} from "../packages/runs/src/pi";
import piExtension, {
  PI_BRIDGE_READY,
  PI_BRIDGE_TITLE,
} from "../packages/runs/src/pi-extension";
import { DomainError } from "../packages/shared/src/index";

const assistant = (stopReason = "stop", usage?: object) => ({
  role: "assistant",
  provider: "controlled",
  model: "exact",
  stopReason,
  content: [{ type: "text", text: "answer" }],
  timestamp: 1,
  ...(usage ? { usage } : {}),
});
const usage = {
  input: 2,
  output: 3,
  cacheRead: 4,
  cacheWrite: 5,
  totalTokens: 14,
};
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function peer(
  options: PiOptions = {},
  tool?: (input: unknown, signal: AbortSignal) => Promise<unknown>,
  output?: (text: string) => Promise<void>,
  onUsage?: (value: PiUsage) => Promise<void>,
) {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const writes: Record<string, unknown>[] = [];
  const outputs: string[] = [];
  const usages: PiUsage[] = [];
  let autoRespond = true;
  const emit = (...messages: unknown[]) =>
    stream.enqueue(
      new TextEncoder().encode(
        `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`,
      ),
    );
  const process: ComputerProcess = {
    reference: "controlled-wire",
    stdout: new ReadableStream({
      start(c) {
        stream = c;
      },
    }),
    exit: new Promise(() => {}),
    async write(bytes) {
      const message: Record<string, unknown> = JSON.parse(
        new TextDecoder().decode(bytes),
      );
      writes.push(message);
      if (!autoRespond || message.type === "extension_ui_response") return;
      const data =
        message.type === "get_state"
          ? {
              sessionId: "session",
              sessionFile: "/private/session.jsonl",
              model: { provider: "controlled", id: "exact" },
              isStreaming: false,
              isCompacting: false,
              pendingMessageCount: 0,
            }
          : message.type === "prompt"
            ? { disposition: "started" }
            : message.type === "steer"
              ? { disposition: "queued" }
              : message.type === "switch_session"
                ? { cancelled: false }
                : undefined;
      emit({
        type: "response",
        command: message.type,
        id: message.id,
        success: true,
        data,
      });
    },
    async stop() {
      return { stopped: true };
    },
    async detach() {},
  };
  const client = connectPi(
    process,
    {
      async onOutput(text) {
        outputs.push(text);
        await output?.(text);
      },
      async handleTool(input, signal) {
        return tool ? tool(input, signal) : { ok: true };
      },
      async onUsage(value) {
        usages.push(value);
        await onUsage?.(value);
      },
    },
    { requestTimeoutMs: 100, cleanupTimeoutMs: 50, ...options },
  );
  emit({
    type: "extension_ui_request",
    id: "ready",
    method: "notify",
    message: JSON.stringify({ bridge: PI_BRIDGE_READY, sessionId: "session" }),
  });
  return {
    client,
    process,
    writes,
    outputs,
    usages,
    emit,
    raw: (bytes: Uint8Array) => stream.enqueue(bytes),
    eof: () => stream.close(),
    manual: () => {
      autoRespond = false;
    },
    async open(contextRef: string | null = null) {
      return client.openSession(contextRef, {
        provider: "controlled",
        model: "exact",
      });
    },
    async start() {
      await this.open();
      const done = client.prompt("work", 1000);
      void done.catch(() => {});
      await tick();
      emit({ type: "agent_start" });
      return { done };
    },
    end(reason = "stop", withSettlement = true) {
      emit(
        { type: "message_start", message: assistant("pending") },
        { type: "message_end", message: assistant(reason, usage) },
        {
          type: "agent_end",
          messages: [assistant(reason, usage)],
          willRetry: false,
        },
      );
      if (withSettlement) emit({ type: "agent_settled" });
    },
    call(toolCallId = "tool", input: unknown = { type: "human.ask" }) {
      emit(
        {
          type: "tool_execution_start",
          toolCallId,
          toolName: "otto",
          args: { input },
        },
        {
          type: "extension_ui_request",
          id: `dialog-${toolCallId}`,
          method: "input",
          title: PI_BRIDGE_TITLE,
          placeholder: JSON.stringify({
            sessionId: "session",
            toolCallId,
            input,
          }),
        },
      );
    },
  };
}

test("Bun drives native-shaped wire: prompt acknowledgement and agent_end do not settle", async () => {
  expect(typeof Bun).toBe("object");
  const p = peer();
  const { done } = await p.start();
  let completed = false;
  void done.then(() => {
    completed = true;
  });
  await tick();
  expect(completed).toBe(false);
  p.end("stop", false);
  await tick();
  expect(completed).toBe(false);
  p.emit({ type: "agent_settled" });
  expect(await done).toBe("finished");
  await p.client.close();
});

test("outputs stay ordered, usage is final per message, completion waits for callbacks", async () => {
  const release = deferred();
  const p = peer({}, undefined, () => release.promise);
  const { done } = await p.start();
  p.emit(
    { type: "message_start", message: assistant("pending") },
    {
      type: "message_update",
      usage,
      assistantMessageEvent: { type: "text_delta", delta: "one" },
    },
    {
      type: "message_update",
      usage,
      assistantMessageEvent: { type: "text_delta", delta: "two" },
    },
    { type: "message_end", message: assistant("stop", usage) },
    { type: "agent_end", messages: [assistant()], willRetry: false },
    { type: "agent_settled" },
  );
  await tick();
  expect(p.outputs).toEqual(["one"]);
  expect(p.usages).toEqual([]);
  release.resolve();
  expect(await done).toBe("finished");
  expect(p.outputs).toEqual(["one", "two"]);
  expect(p.usages).toEqual([
    {
      sequence: 1,
      provider: "controlled",
      model: "exact",
      inputTokens: 2,
      outputTokens: 3,
      cacheReadTokens: 4,
      cacheWriteTokens: 5,
      totalTokens: 14,
    },
  ]);
  await p.client.close();
});

test("missing usage stays unknown and private thoughts never become shared text", async () => {
  const p = peer();
  const { done } = await p.start();
  p.emit(
    { type: "message_start", message: assistant("pending") },
    {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "private" },
    },
    { type: "message_end", message: assistant() },
    { type: "agent_end", messages: [assistant()], willRetry: false },
    { type: "agent_settled" },
  );
  expect(await done).toBe("finished");
  expect(p.outputs).toEqual([]);
  expect(p.usages[0]?.totalTokens).toBeNull();
  await p.client.close();
});

test.each(["aborted", "error", "length"])(
  "final %s outcome is explicit",
  async (reason) => {
    const p = peer();
    const { done } = await p.start();
    p.end(reason);
    expect(await done).toBe(reason === "aborted" ? "aborted" : "failed");
    await p.client.close();
  },
);

test("pending human question does not block reader or steer, cancellation aborts and joins", async () => {
  const accepted = deferred();
  const aborted = deferred();
  const p = peer({}, async (_input, signal) => {
    accepted.resolve();
    await new Promise<void>((resolve) =>
      signal.addEventListener(
        "abort",
        () => {
          aborted.resolve();
          resolve();
        },
        { once: true },
      ),
    );
    return {};
  });
  const { done } = await p.start();
  p.call();
  await accepted.promise;
  await p.client.steer("guidance");
  expect(p.writes.some((w) => w.type === "steer")).toBe(true);
  await p.client.cancel();
  await aborted.promise;
  p.emit({
    type: "tool_execution_end",
    toolCallId: "tool",
    toolName: "otto",
    result: {},
    isError: true,
  });
  p.end("aborted");
  expect(await done).toBe("aborted");
  await p.client.close();
  expect(p.writes.some((w) => w.type === "extension_ui_response")).toBe(false);
});

test("cancel joins final usage arriving before the abort acknowledgement", async () => {
  const entered = deferred();
  const release = deferred();
  let joined = false;
  const p = peer({}, undefined, undefined, async () => {
    entered.resolve();
    await release.promise;
    joined = true;
  });
  const { done } = await p.start();
  p.manual();
  let resolved = false;
  const cancellation = p.client.cancel().then(() => {
    resolved = true;
  });
  await tick();
  p.end("aborted");
  await entered.promise;
  const abort = p.writes.find((frame) => frame.type === "abort");
  p.emit({ type: "response", command: "abort", id: abort?.id, success: true });
  await tick();
  const beforeRelease = { resolved, joined };
  release.resolve();
  await cancellation;
  expect(beforeRelease).toEqual({ resolved: false, joined: false });
  expect(joined).toBe(true);
  expect(await done).toBe("aborted");
  await p.client.close();
});

test("Stop during settled callback drain resolves the prompt as aborted", async () => {
  const entered = deferred();
  const release = deferred();
  const p = peer({}, undefined, undefined, async () => {
    entered.resolve();
    await release.promise;
  });
  const { done } = await p.start();
  p.end();
  await entered.promise;
  const cancellation = p.client.cancel();
  release.resolve();
  await cancellation;
  expect(await done).toBe("aborted");
  await p.client.close();
});

test("late usage ignoring cancellation preserves cleanup uncertainty", async () => {
  const entered = deferred();
  const release = deferred();
  const p = peer({ cleanupTimeoutMs: 20 }, undefined, undefined, async () => {
    entered.resolve();
    await release.promise;
  });
  const { done } = await p.start();
  p.manual();
  const cancellation = p.client.cancel();
  void cancellation.catch(() => {});
  await tick();
  p.end("aborted", false);
  await entered.promise;
  const abort = p.writes.find((frame) => frame.type === "abort");
  p.emit({ type: "response", command: "abort", id: abort?.id, success: true });
  let failure: unknown;
  try {
    await cancellation;
  } catch (error) {
    failure = error;
  }
  release.resolve();
  expect(failure).toBeInstanceOf(DomainError);
  expect((failure as Error).message).toContain("retain uncertainty");
  await expect(p.client.cancel()).rejects.toBe(failure);
  await expect(done).rejects.toBe(failure);
  await expect(p.client.close()).rejects.toBe(failure);
  await expect(p.client.close()).rejects.toBe(failure);
});

test("ignored cancellation throws, and repeated close preserves its failure", async () => {
  const accepted = deferred();
  const release = deferred();
  const p = peer({ cleanupTimeoutMs: 10 }, async () => {
    accepted.resolve();
    await release.promise;
    return {};
  });
  const { done } = await p.start();
  p.call();
  await accepted.promise;
  await expect(p.client.cancel()).rejects.toThrow("retain uncertainty");
  await expect(done).rejects.toThrow("retain uncertainty");
  const closing = p.client.close();
  expect(p.client.close()).toBe(closing);
  await expect(closing).rejects.toThrow("retain uncertainty");
  release.resolve();
  await tick();
  await expect(p.client.close()).rejects.toThrow("retain uncertainty");
});

test("accepted tools are serial and settlement waits for drained work", async () => {
  const release = deferred();
  const calls: unknown[] = [];
  const p = peer({}, async (input) => {
    calls.push(input);
    if (calls.length === 1) await release.promise;
    return calls.length;
  });
  const { done } = await p.start();
  p.call("one", { n: 1 });
  p.call("two", { n: 2 });
  await tick();
  expect(calls).toEqual([{ n: 1 }]);
  release.resolve();
  await tick();
  expect(calls).toEqual([{ n: 1 }, { n: 2 }]);
  expect(
    p.writes.filter((w) => w.type === "extension_ui_response").map((w) => w.id),
  ).toEqual(["dialog-one", "dialog-two"]);
  p.emit(
    { type: "tool_execution_end", toolCallId: "one", toolName: "otto" },
    { type: "tool_execution_end", toolCallId: "two", toolName: "otto" },
  );
  p.end();
  expect(await done).toBe("finished");
  await p.client.close();
});

test.each([
  "wrongSession",
  "ordinaryDialog",
  "modelChange",
  "unknownEvent",
  "settledWithoutOutcome",
  "conflictingReplay",
])("rejects %s", async (violation) => {
  const p = peer();
  const { done } = await p.start();
  if (violation === "wrongSession") {
    p.emit(
      {
        type: "tool_execution_start",
        toolCallId: "tool",
        toolName: "otto",
        args: { input: {} },
      },
      {
        type: "extension_ui_request",
        id: "dialog",
        method: "input",
        title: PI_BRIDGE_TITLE,
        placeholder: JSON.stringify({
          sessionId: "foreign",
          toolCallId: "tool",
          input: {},
        }),
      },
    );
  } else if (violation === "ordinaryDialog")
    p.emit({
      type: "extension_ui_request",
      id: "dialog",
      method: "confirm",
      title: "Permission",
    });
  else if (violation === "modelChange")
    p.emit({
      type: "message_start",
      message: { ...assistant(), model: "fallback" },
    });
  else if (violation === "unknownEvent") p.emit({ type: "_otto/tool" });
  else if (violation === "settledWithoutOutcome")
    p.emit({ type: "agent_settled" });
  else
    p.emit(
      { type: "message_start", message: assistant("pending") },
      { type: "message_end", message: assistant() },
      { type: "message_end", message: assistant("stop", usage) },
    );
  await expect(done).rejects.toThrow(
    violation === "conflictingReplay" ? "replay conflict" : undefined,
  );
  await expect(p.client.close()).rejects.toThrow();
});

test("request command and id correlation are mandatory", async () => {
  const p = peer();
  p.manual();
  const opened = p.open();
  await tick();
  p.emit({
    type: "response",
    id: p.writes[0]?.id,
    command: "abort",
    success: true,
  });
  await expect(opened).rejects.toThrow("Uncorrelated");
  await expect(p.client.close()).rejects.toThrow("Uncorrelated");
});

test("retained private session reference and model must match; no export or model-selection command", async () => {
  const p = peer();
  expect(await p.open("/private/session.jsonl")).toBe("/private/session.jsonl");
  expect(p.writes.map((w) => w.type)).toEqual(["switch_session", "get_state"]);
  await p.client.close();
});

test("coalesced complete frames can exceed line size; oversized/truncated/malformed frames fail", async () => {
  const p = peer();
  const { done } = await p.start();
  p.emit(
    ...Array.from({ length: 4 }, () => ({
      type: "entry_appended",
      entry: { private: "x".repeat(70000) },
    })),
  );
  p.end();
  expect(await done).toBe("finished");
  await p.client.close();
  for (const bad of ["x".repeat(262145), "{bad}\n", '{"type":']) {
    const q = peer();
    const result = await q.start();
    q.raw(new TextEncoder().encode(bad));
    if (bad === '{"type":') q.eof();
    await expect(result.done).rejects.toThrow();
    await expect(q.client.close()).rejects.toThrow();
  }
});

test("bounds queued callbacks, native tools, published output and in-flight commands", async () => {
  const cases = ["output", "tools", "requests"];
  for (const limit of cases) {
    const release = deferred();
    const p = peer({ maxOutputBytes: 1 }, () => release.promise);
    const { done } = await p.start();
    if (limit === "output")
      p.emit(
        { type: "message_start", message: assistant("pending") },
        {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "too much" },
        },
      );
    if (limit === "tools") {
      for (let i = 0; i < 9; i++) p.call(String(i));
    }
    if (limit === "requests") {
      p.manual();
      const requests = Array.from({ length: 9 }, () =>
        p.client.steer("keep working"),
      );
      await expect(requests[8]).rejects.toThrow("busy");
      void Promise.allSettled(requests);
      await p.client.close();
      await expect(done).rejects.toThrow();
      continue;
    }
    await expect(done).rejects.toThrow();
    release.resolve();
    await expect(p.client.close()).rejects.toThrow();
  }
});

test("unexpected tool implementation failure is observed; domain denials become safe tool errors", async () => {
  const p = peer({}, async () => {
    throw new Error("implementation failed");
  });
  const { done } = await p.start();
  p.call();
  await expect(done).rejects.toThrow("implementation failed");
  await expect(p.client.close()).rejects.toThrow("implementation failed");
  const q = peer({}, async () => {
    throw new DomainError("forbidden");
  });
  const result = await q.start();
  q.call();
  await tick();
  expect(q.writes.find((w) => w.type === "extension_ui_response")?.value).toBe(
    '{"success":false}',
  );
  q.emit({ type: "tool_execution_end", toolCallId: "tool", toolName: "otto" });
  q.end();
  expect(await result.done).toBe("finished");
  await q.client.close();
});

test("managed extension uses native cancellable UI input and bounded safe result", async () => {
  let execute!: Parameters<
    Parameters<typeof piExtension>[0]["registerTool"]
  >[0]["execute"];
  let ready!: Parameters<Parameters<typeof piExtension>[0]["on"]>[1];
  vi.stubEnv(
    "OTTO_TOOL_SCHEMA",
    JSON.stringify({
      type: "object",
      properties: { name: { const: "human.ask" } },
      required: ["name"],
    }),
  );
  piExtension({
    registerTool(tool) {
      execute = tool.execute;
    },
    on(_event, handler) {
      ready = handler;
    },
  });
  const notices: string[] = [];
  let seenSignal: AbortSignal | undefined;
  const controller = new AbortController();
  const context = {
    mode: "rpc",
    sessionManager: { getSessionId: () => "session" },
    ui: {
      notify(message: string) {
        notices.push(message);
      },
      async input(
        title: string,
        placeholder: string,
        opts: { signal?: AbortSignal },
      ) {
        expect(title).toBe(PI_BRIDGE_TITLE);
        expect(JSON.parse(placeholder)).toEqual({
          sessionId: "session",
          toolCallId: "call",
          input: { name: "human.ask" },
        });
        seenSignal = opts.signal;
        return '{"success":true,"result":{"answer":"yes"}}';
      },
    },
  };
  vi.unstubAllEnvs();
  ready({}, context);
  expect(JSON.parse(notices[0] ?? "").bridge).toBe(PI_BRIDGE_READY);
  const result = await execute(
    "call",
    { input: { name: "human.ask" } },
    controller.signal,
    undefined,
    context,
  );
  expect(seenSignal).toBe(controller.signal);
  expect(result.content).toEqual([{ type: "text", text: '{"answer":"yes"}' }]);
});

test("external abort signal is composed and blocks later admission", async () => {
  const external = new AbortController();
  const accepted = deferred();
  const released = deferred();
  const p = peer({ signal: external.signal }, async (_input, signal) => {
    accepted.resolve();
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    released.resolve();
    return {};
  });
  const { done } = await p.start();
  p.call();
  await accepted.promise;
  external.abort();
  await released.promise;
  await p.client.cancel();
  p.emit({ type: "tool_execution_end", toolCallId: "tool", toolName: "otto" });
  p.end("aborted");
  expect(await done).toBe("aborted");
  await expect(
    p.client.openSession(null, { provider: "controlled", model: "exact" }),
  ).rejects.toThrow();
  await p.client.close();
});

test("output backlog and protocol bytes are bounded independently", async () => {
  for (const bound of ["backlog", "protocol"]) {
    const release = deferred();
    const p = peer(
      bound === "protocol" ? { maxProtocolBytes: 1000 } : {},
      undefined,
      () => release.promise,
    );
    const { done } = await p.start();
    if (bound === "protocol")
      p.emit({ type: "entry_appended", entry: { private: "x".repeat(1001) } });
    else
      p.emit(
        { type: "message_start", message: assistant("pending") },
        ...Array.from({ length: 129 }, () => ({
          type: "message_update",
          usage,
          assistantMessageEvent: { type: "text_delta", delta: "x" },
        })),
      );
    await expect(done).rejects.toThrow(
      bound === "protocol" ? "protocol output limit" : "output backlog limit",
    );
    release.resolve();
    await expect(p.client.close()).rejects.toThrow();
  }
});

test("tool-result overflow and callback cleanup timeout are observable", async () => {
  const p = peer({}, async () => "x".repeat(131073));
  const { done } = await p.start();
  p.call();
  await expect(done).rejects.toThrow("tool result limit");
  await expect(p.client.close()).rejects.toThrow("tool result limit");
  const release = deferred();
  const q = peer({ cleanupTimeoutMs: 10 }, undefined, () => release.promise);
  const result = await q.start();
  q.emit(
    { type: "message_start", message: assistant("pending") },
    {
      type: "message_update",
      usage,
      assistantMessageEvent: { type: "text_delta", delta: "text" },
    },
    { type: "message_end", message: assistant() },
    { type: "agent_end", messages: [assistant()], willRetry: false },
    { type: "agent_settled" },
  );
  await expect(result.done).rejects.toThrow("cleanup timeout");
  release.resolve();
  await expect(q.client.close()).rejects.toThrow("cleanup timeout");
});

test("close joins accepted writes and reports a transport which ignores cleanup", async () => {
  const p = peer({ cleanupTimeoutMs: 10 });
  await p.open();
  const release = deferred();
  p.process.write = async () => release.promise;
  const started = p.client.prompt("work", 1000);
  void started.catch(() => {});
  await tick();
  const closed = p.client.close();
  await expect(closed).rejects.toThrow("timeout");
  release.resolve();
  await expect(started).rejects.toThrow();
  expect(p.client.close()).toBe(closed);
  await expect(p.client.close()).rejects.toThrow("timeout");
});

test("request/prompt timeouts, malformed UTF-8 and managed commands fail closed", async () => {
  const p = peer({ requestTimeoutMs: 10 });
  p.manual();
  await expect(p.open()).rejects.toThrow("request timeout");
  await expect(p.client.close()).rejects.toThrow("request timeout");
  const q = peer();
  await q.open();
  await expect(q.client.prompt("/model unauthorized", 10)).rejects.toThrow(
    "commands",
  );
  await q.client.close();
  const r = peer();
  await r.open();
  await expect(r.client.prompt("work", 10)).rejects.toThrow("prompt timeout");
  await expect(r.client.close()).rejects.toThrow("prompt timeout");
  const s = peer();
  const { done } = await s.start();
  s.raw(new Uint8Array([255, 10]));
  await expect(done).rejects.toThrow();
  await expect(s.client.close()).rejects.toThrow();
});

test("native tool abandonment aborts accepted server work without a late reply", async () => {
  const accepted = deferred();
  const aborted = deferred();
  const p = peer({}, async (_input, signal) => {
    accepted.resolve();
    await new Promise<void>((resolve) =>
      signal.addEventListener(
        "abort",
        () => {
          aborted.resolve();
          resolve();
        },
        { once: true },
      ),
    );
    return {};
  });
  const { done } = await p.start();
  p.call();
  await accepted.promise;
  p.emit({
    type: "tool_execution_end",
    toolCallId: "tool",
    toolName: "otto",
    isError: true,
  });
  await aborted.promise;
  p.end("error");
  expect(await done).toBe("failed");
  expect(p.writes.some((w) => w.type === "extension_ui_response")).toBe(false);
  await p.client.close();
});

test("abort between agent_end and settlement retains the human stop outcome", async () => {
  const p = peer();
  const { done } = await p.start();
  p.end("error", false);
  await tick();
  await p.client.cancel();
  p.emit({ type: "agent_settled" });
  expect(await done).toBe("aborted");
  await p.client.close();
});

test("exact final message replay reuses its original sequence and conflicting replay fails", async () => {
  const p = peer();
  const { done } = await p.start();
  const message = assistant("stop", usage);
  p.emit(
    { type: "message_start", message: assistant("pending") },
    { type: "message_end", message },
    { type: "message_end", message },
    { type: "agent_end", messages: [message], willRetry: false },
    { type: "agent_settled" },
  );
  expect(await done).toBe("finished");
  expect(p.usages.map((u) => u.sequence)).toEqual([1, 1]);
  expect(p.usages[0]).toEqual(p.usages[1]);
  await p.client.close();
});

// Lines below are verbatim from the published Pi 1.0.0 CLI over RPC against a controlled Responses peer
// (automatic threshold compaction; summary retries after a 500). Only the long opaque summary text was shortened.
const nativeCompactionStart = { type: "compaction_start", reason: "threshold" };
const nativeCompactionEnd = {
  type: "compaction_end",
  reason: "threshold",
  result: {
    summary: "SUMMARY",
    firstKeptEntryId: "65d9884f",
    tokensBefore: 19505,
    estimatedTokensAfter: 1055,
    usage: {
      input: 400,
      output: 7,
      cacheRead: 100,
      cacheWrite: 0,
      reasoning: 0,
      totalTokens: 507,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    details: { readFiles: [], modifiedFiles: [] },
  },
  aborted: false,
  willRetry: false,
};
const nativeSummaryRetry = {
  type: "summarization_retry_scheduled",
  attempt: 1,
  maxAttempts: 3,
  delayMs: 2000,
  errorMessage: "codex API error (500): 500 boom",
};
const nativeCompactionFailed = {
  type: "compaction_end",
  reason: "threshold",
  aborted: false,
  willRetry: false,
  errorMessage:
    "Auto-compaction failed: Summarization failed: codex API error (500): 500 boom",
};
function messageThen(p: ReturnType<typeof peer>, ...events: unknown[]) {
  p.emit(
    { type: "message_start", message: assistant("pending") },
    { type: "message_end", message: assistant("stop", usage) },
    { type: "agent_end", messages: [assistant()], willRetry: false },
    ...events,
  );
}

test("native automatic compaction summary is one extra receipt after the message, never colliding with its sequence", async () => {
  const p = peer();
  const { done } = await p.start();
  messageThen(p, nativeCompactionStart, nativeCompactionEnd, {
    type: "agent_settled",
  });
  expect(await done).toBe("finished");
  expect(p.usages).toEqual([
    {
      sequence: 1,
      provider: "controlled",
      model: "exact",
      inputTokens: 2,
      outputTokens: 3,
      cacheReadTokens: 4,
      cacheWriteTokens: 5,
      totalTokens: 14,
    },
    {
      sequence: 2,
      provider: "controlled",
      model: "exact",
      inputTokens: 400,
      outputTokens: 7,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      totalTokens: 507,
    },
  ]);
  await p.client.close();
});

test("native summary failure and retries record unmeasured requests, never inferred counts", async () => {
  const p = peer();
  const { done } = await p.start();
  messageThen(
    p,
    nativeCompactionStart,
    nativeSummaryRetry,
    {
      type: "summarization_retry_attempt_start",
      source: "compaction",
      reason: "threshold",
    },
    nativeSummaryRetry,
    { type: "summarization_retry_finished" },
    nativeCompactionFailed,
    { type: "agent_settled" },
  );
  expect(await done).toBe("finished");
  expect(p.usages.map((u) => [u.sequence, u.totalTokens])).toEqual([
    [1, 14],
    [2, null],
    [3, null],
    [4, null],
  ]);
  expect(
    p.usages
      .slice(1)
      .every((u) => u.inputTokens === null && u.outputTokens === null),
  ).toBe(true);
  await p.client.close();
});

test("an interrupted compaction records one unmeasured request and the human stop outcome", async () => {
  const p = peer();
  const { done } = await p.start();
  messageThen(p, nativeCompactionStart);
  await tick();
  const cancelled = p.client.cancel();
  await tick();
  p.emit(
    {
      type: "compaction_end",
      reason: "threshold",
      aborted: true,
      willRetry: false,
    },
    { type: "agent_settled" },
  );
  await cancelled;
  expect(await done).toBe("aborted");
  expect(p.usages.map((u) => [u.sequence, u.totalTokens])).toEqual([
    [1, 14],
    [2, null],
  ]);
  await p.client.close();
});

// Verbatim from the published Pi 1.0.0 CLI after its one compact-and-retry already ran (evidence overflow-wire.txt):
// a terminal notification with no compaction_start, because no summary request was made.
const nativeOverflowRecoveryFailed = {
  type: "compaction_end",
  reason: "overflow",
  aborted: false,
  willRetry: false,
  errorMessage:
    "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
};

test("native overflow-recovery-failed notification without a start completes the Run and adds no receipt", async () => {
  const p = peer();
  const { done } = await p.start();
  messageThen(
    p,
    nativeCompactionStart,
    nativeCompactionEnd,
    nativeOverflowRecoveryFailed,
    { type: "agent_settled" },
  );
  expect(await done).toBe("finished");
  expect(p.usages.map((u) => [u.sequence, u.totalTokens])).toEqual([
    [1, 14],
    [2, 507],
  ]);
  await p.client.close();
});

test.each([
  ["a result", { result: nativeCompactionEnd.result }],
  ["an aborted flag", { aborted: true }],
  ["a retry", { willRetry: true }],
  ["another reason", { reason: "threshold" }],
  ["no message", { errorMessage: undefined }],
])(
  "an unstarted compaction end with %s is not the legitimate notification",
  async (_name, change) => {
    const p = peer();
    const { done } = await p.start();
    void done.catch(() => {});
    messageThen(p, { ...nativeOverflowRecoveryFailed, ...change });
    await expect(done).rejects.toThrow("compaction");
    expect(p.usages.map((u) => u.sequence)).toEqual([1]);
    await expect(p.client.close()).rejects.toThrow("compaction");
  },
);

test("duplicate or uncorrelated native compaction events fail closed without another receipt", async () => {
  const duplicate = peer();
  const first = await duplicate.start();
  void first.done.catch(() => {});
  messageThen(
    duplicate,
    nativeCompactionStart,
    nativeCompactionEnd,
    nativeCompactionEnd,
  );
  await expect(first.done).rejects.toThrow("compaction");
  expect(duplicate.usages.map((u) => u.sequence)).toEqual([1, 2]);
  await expect(duplicate.client.close()).rejects.toThrow("compaction");
  const orphan = peer();
  const second = await orphan.start();
  void second.done.catch(() => {});
  orphan.emit(nativeCompactionEnd);
  await expect(second.done).rejects.toThrow("compaction");
  expect(orphan.usages).toEqual([]);
  await expect(orphan.client.close()).rejects.toThrow("compaction");
  const nested = peer();
  const third = await nested.start();
  void third.done.catch(() => {});
  nested.emit(nativeCompactionStart, nativeCompactionStart);
  await expect(third.done).rejects.toThrow("compaction");
  await expect(nested.client.close()).rejects.toThrow("compaction");
});

test("approved native computer tool events stay private and cannot impersonate the scoped bridge", async () => {
  const p = peer();
  const { done } = await p.start();
  p.emit(
    {
      type: "tool_execution_start",
      toolCallId: "file",
      toolName: "write",
      args: { path: "result.txt", content: "private" },
    },
    {
      type: "tool_execution_end",
      toolCallId: "file",
      toolName: "write",
      result: {},
      isError: false,
    },
  );
  p.end();
  expect(await done).toBe("finished");
  expect(p.outputs).toEqual([]);
  expect(p.writes.filter((w) => w.type === "extension_ui_response")).toEqual(
    [],
  );
  await p.client.close();
  const q = peer();
  const result = await q.start();
  q.emit(
    {
      type: "tool_execution_start",
      toolCallId: "file",
      toolName: "bash",
      args: { command: "private" },
    },
    {
      type: "extension_ui_request",
      id: "dialog",
      method: "input",
      title: PI_BRIDGE_TITLE,
      placeholder: JSON.stringify({
        sessionId: "session",
        toolCallId: "file",
        input: {},
      }),
    },
  );
  await expect(result.done).rejects.toThrow("tool call");
  await expect(q.client.close()).rejects.toThrow("tool call");
});

test.each([
  undefined,
  "not json",
  "{}",
  "[]",
  " ".repeat(65537),
  '{"anyOf":[]}',
])(
  "managed extension rejects absent/malformed/bounded schema config",
  (schema) => {
    vi.stubEnv("OTTO_TOOL_SCHEMA", schema);
    try {
      expect(() =>
        piExtension({
          registerTool() {
            throw new Error("must not register");
          },
          on() {},
        }),
      ).toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  },
);
