import type {
  ComputerBackend,
  ComputerProcess,
  ProcessInspection,
} from "../../packages/environments/src";

/** Controlled protocol fixture only: no VM, isolation, billing or native credentials are exercised. */
export class ControlledComputer implements ComputerBackend {
  provider = "controlled-fixture";
  launches = 0;
  readonly detachFailures = new Set<string>();
  readonly detached: string[] = [];
  bridgeReady = true;
  model = "fixture";
  replayOnLoad = false;
  usageReplay: "none" | "same" | "changed" = "none";
  toolResults: unknown[] = [];
  readonly inputs: Parameters<ComputerBackend["launch"]>[0][] = [];
  loseNextAcknowledgement = false;
  confirmStop = true;
  beforeInspect?: () => Promise<void>;
  capabilities = {
    isolated: true,
    persistent: true,
    scopeIsolation: true,
    launchLookup: true,
    deadline: true,
    treeStop: true,
    stdio: true,
    files: true,
  };
  readonly executions = new Map<
    string,
    {
      process: ComputerProcess;
      exited: boolean;
      timer: ReturnType<typeof setTimeout>;
      computerRef: string;
    }
  >();
  constructor(readonly subscriptionId: string) {}
  async inspectComputer() {
    await this.beforeInspect?.();
    return {
      capabilities: this.capabilities,
    };
  }
  async launch(input: Parameters<ComputerBackend["launch"]>[0]) {
    const prior = this.executions.get(input.launchKey);
    if (prior) return prior.process;
    this.launches++;
    this.inputs.push(input);
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let resolveExit: (code: number) => void = () => {};
    let streamClosed = false;
    const exit = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const sessionId = crypto.randomUUID();
    let toolPending = false;
    let assistantOpen = false;
    let sessionFile = `/private/${sessionId}.jsonl`;
    const send = (message: unknown) => {
      if (!streamClosed)
        controller?.enqueue(
          new TextEncoder().encode(`${JSON.stringify(message)}\n`),
        );
    };
    const stop = () => {
      const entry = this.executions.get(input.launchKey);
      if (entry) {
        entry.exited = true;
        clearTimeout(entry.timer);
      }
      if (!streamClosed) {
        streamClosed = true;
        controller?.close();
      }
      resolveExit(0);
    };
    const assistant = (stopReason: string) => ({
      role: "assistant",
      provider: "codex",
      model: this.model,
      stopReason,
      usage: {
        input: 10,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 12,
      },
    });
    const beginAssistant = () => {
      assistantOpen = true;
      send({ type: "message_start", message: assistant("pending") });
    };
    const endAssistant = (stopReason: string) => {
      assistantOpen = false;
      const message = assistant(stopReason);
      send({ type: "message_end", message });
      if (this.usageReplay !== "none")
        send({
          type: "message_end",
          message:
            this.usageReplay === "same"
              ? message
              : {
                  ...message,
                  usage: { ...message.usage, output: 3, totalTokens: 13 },
                },
        });
    };
    const text = (delta: string) =>
      send({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta },
      });
    const finish = (stopReason = "stop") => {
      if (!assistantOpen) beginAssistant();
      endAssistant(stopReason);
      send({ type: "agent_end", messages: [], willRetry: false });
      send({ type: "agent_settled" });
    };
    const ready = () =>
      send({
        type: "extension_ui_request",
        id: crypto.randomUUID(),
        method: "notify",
        message: JSON.stringify({ bridge: "otto.bridge.v1", sessionId }),
      });
    const bridgeReady = this.bridgeReady;
    const process: ComputerProcess = {
      reference: input.launchKey,
      stdout: new ReadableStream({
        start(c) {
          controller = c;
          if (bridgeReady) ready();
        },
        cancel() {
          streamClosed = true;
        },
      }),
      exit,
      write: async (bytes) => {
        const request = JSON.parse(new TextDecoder().decode(bytes));
        if (request.type === "extension_ui_response") {
          const response = JSON.parse(request.value);
          this.toolResults.push(response.success ? response.result : response);
          if (toolPending) {
            toolPending = false;
            send({
              type: "tool_execution_end",
              toolCallId: "otto-tool",
              toolName: "otto",
            });
            finish();
          }
          return;
        }
        const response = (data?: unknown) =>
          send({
            type: "response",
            command: request.type,
            id: request.id,
            success: true,
            data,
          });
        if (request.type === "get_state")
          response({
            sessionId,
            sessionFile,
            model: { provider: "codex", id: this.model },
            isStreaming: false,
            isCompacting: false,
            pendingMessageCount: 0,
          });
        else if (request.type === "switch_session") {
          sessionFile = request.sessionPath;
          ready();
          response({ cancelled: false });
        } else if (request.type === "prompt") {
          response({ disposition: "started" });
          send({ type: "agent_start" });
          beginAssistant();
          text("fixture output");
          const body = request.message;
          if (body.includes("_tool=")) {
            const input = JSON.parse(body.split("_tool=")[1]);
            endAssistant("toolUse");
            toolPending = true;
            send({
              type: "tool_execution_start",
              toolCallId: "otto-tool",
              toolName: "otto",
              args: { input },
            });
            send({
              type: "extension_ui_request",
              id: "otto-tool-dialog",
              method: "input",
              title: "otto.tool.v1",
              placeholder: JSON.stringify({
                sessionId,
                toolCallId: "otto-tool",
                input,
              }),
            });
          } else if (body.includes("oversized")) text("x".repeat(300000));
          else if (!body.includes("hold")) finish();
        } else if (request.type === "steer") {
          response({ disposition: "queued" });
          if (!toolPending) text(`fixture after steer: ${request.message}`);
        } else if (request.type === "abort") {
          if (toolPending) {
            toolPending = false;
            send({
              type: "tool_execution_end",
              toolCallId: "otto-tool",
              toolName: "otto",
            });
          }
          finish("aborted");
          response();
        }
      },
      stop: async () => {
        if (this.confirmStop) stop();
        return { stopped: this.confirmStop };
      },
      detach: async () => {
        this.detached.push(input.computerRef);
        if (this.detachFailures.delete(input.computerRef))
          throw new Error("controlled detach failure");
        if (!streamClosed) {
          streamClosed = true;
          controller?.close();
        }
      },
    };
    const timer = setTimeout(
      stop,
      Math.max(1, input.deadlineAt.getTime() - Date.now()),
    );
    this.executions.set(input.launchKey, {
      process,
      exited: false,
      timer,
      computerRef: input.computerRef,
    });
    if (input.argv[0] === "/bin/sh" && !input.argv[2]?.includes("hold")) {
      queueMicrotask(() => {
        if (!streamClosed)
          controller?.enqueue(
            new TextEncoder().encode("fixture script output"),
          );
        stop();
      });
    }
    if (this.loseNextAcknowledgement) {
      this.loseNextAcknowledgement = false;
      throw new Error("fixture lost launch acknowledgement");
    }
    return process;
  }
  async lookup(
    _computerRef: string,
    launchKey: string,
  ): Promise<ProcessInspection> {
    const entry = this.executions.get(launchKey);
    if (!entry) return { state: "absent" };
    return entry.exited
      ? {
          state: "exited",
          reference: entry.process.reference,
          exitCode: 0,
          stopped: true,
        }
      : { state: "running", process: entry.process };
  }
  async close() {
    this.confirmStop = true;
    for (const entry of this.executions.values()) await entry.process.stop();
  }
}
