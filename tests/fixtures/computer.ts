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
  protocolVersion = 1;
  model = "fixture";
  replayOnLoad = false;
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
  constructor(readonly connectionId: string) {}
  async inspectComputer() {
    await this.beforeInspect?.();
    return {
      capabilities: this.capabilities,
      account: {
        connectionId: this.connectionId,
        mode: "native_subscription" as const,
      },
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
    let toolPromptId: number | undefined;
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
    const config = () => ({
      configOptions: [
        {
          id: "model",
          category: "model",
          type: "select",
          currentValue: this.model,
          options: [{ value: "fixture" }],
        },
      ],
    });
    const process: ComputerProcess = {
      reference: input.launchKey,
      stdout: new ReadableStream({
        start(c) {
          controller = c;
        },
        cancel() {
          streamClosed = true;
        },
      }),
      exit,
      write: async (bytes) => {
        const request = JSON.parse(new TextDecoder().decode(bytes));
        if (request.id === "otto-tool") {
          this.toolResults.push(request.result ?? request.error);
          if (toolPromptId !== undefined)
            send({
              jsonrpc: "2.0",
              id: toolPromptId,
              result: { stopReason: "end_turn" },
            });
          return;
        }
        const result = (value: unknown) =>
          send({ jsonrpc: "2.0", id: request.id, result: value });
        if (request.method === "initialize")
          result({
            protocolVersion: this.protocolVersion,
            agentCapabilities: {
              loadSession: true,
              _meta: { ottoTools: true, ottoSteer: true },
            },
          });
        else if (request.method === "session/new")
          result({ sessionId, ...config() });
        else if (request.method === "session/load") {
          if (this.replayOnLoad)
            send({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: request.params.sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "PRIVATE NATIVE HISTORY" },
                },
              },
            });
          result(config());
        } else if (request.method === "session/set_config_option") {
          this.model = request.params.value;
          result(config());
        } else if (request.method === "session/prompt") {
          const id = request.params.sessionId;
          const text = request.params.prompt[0].text;
          send({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: id,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "fixture output" },
              },
            },
          });
          if (text.includes("_tool=")) {
            toolPromptId = request.id;
            send({
              jsonrpc: "2.0",
              id: "otto-tool",
              method: "_otto/tool",
              params: {
                sessionId: id,
                input: JSON.parse(text.split("_tool=")[1]),
              },
            });
          } else if (text.includes("oversized")) {
            send({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: id,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "x".repeat(300000) },
                },
              },
            });
          } else if (!text.includes("hold")) result({ stopReason: "end_turn" });
        } else if (request.method === "_otto/steer") {
          send({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: request.params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: {
                  type: "text",
                  text: `fixture after steer: ${request.params.text}`,
                },
              },
            },
          });
          result({});
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
