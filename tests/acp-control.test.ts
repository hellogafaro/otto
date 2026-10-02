import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ComputerProcess } from "../packages/environments/src/computer";
import { type AcpHandlers, connectAcp } from "../packages/runs/src/acp";

const frame = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

// A controlled wire peer, not a native harness or isolated computer qualification.
function peer() {
  const output = new TransformStream<Uint8Array, Uint8Array>();
  const writer = output.writable.getWriter();
  const received: z.infer<typeof frame>[] = [];
  const emit = (message: object) =>
    writer.write(
      new TextEncoder().encode(
        `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`,
      ),
    );
  const process: ComputerProcess = {
    reference: "controlled-acp",
    stdout: output.readable,
    exit: Promise.resolve(0),
    async write(bytes) {
      const message = frame.parse(JSON.parse(new TextDecoder().decode(bytes)));
      received.push(message);
      let result: unknown;
      if (message.method === "initialize")
        result = {
          protocolVersion: 1,
          agentCapabilities: { _meta: { ottoTools: true, ottoSteer: true } },
        };
      else if (message.method === "session/new")
        result = {
          sessionId: "session",
          configOptions: [
            {
              id: "model",
              category: "model",
              type: "select",
              currentValue: "fixture",
              options: [{ value: "fixture" }],
            },
          ],
        };
      else if (message.method === "_otto/steer") result = {};
      else return;
      // Real duplex I/O: accepting stdin does not wait for stdout consumption.
      void emit({ id: message.id, result }).catch(() => {});
    },
    async stop() {
      return { stopped: true };
    },
    async detach() {},
  };
  return { process, emit, received, end: () => writer.close() };
}

async function promptly<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Control blocked behind tool")),
          500,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function open(handlers: AcpHandlers) {
  const wire = peer();
  const acp = connectAcp(wire.process, handlers);
  await acp.initialize();
  await acp.openSession(null, "fixture");
  const prompt = acp.prompt("work", 20000).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  const tool = (id: string, name = "human.ask", sessionId = "session") =>
    wire.emit({
      id,
      method: "_otto/tool",
      params: { sessionId, input: { name } },
    });
  return { ...wire, acp, prompt, tool };
}

describe("ACP controls during pending scoped tools", () => {
  it("consumes an immediate steer response while a human question remains unanswered", async () => {
    expect(process.versions.bun).toBeTruthy();
    const wire = peer();
    const entered = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<void>();
    const acp = connectAcp(wire.process, {
      onOutput: async () => {},
      handleTool: async () => {
        entered.resolve();
        await answer.promise;
        return { answer: "later" };
      },
    });
    await acp.initialize();
    await acp.openSession(null, "fixture");
    const prompt = acp.prompt("ask", 20000).catch(() => {});
    try {
      await wire.emit({
        id: "question",
        method: "_otto/tool",
        params: { sessionId: "session", input: { name: "human.ask" } },
      });
      await entered.promise;
      await promptly(acp.steer("continue"));
      expect(wire.received.some((m) => m.id === "question")).toBe(false);
      await promptly(acp.cancel());
      expect(wire.received.at(-1)?.method).toBe("session/cancel");
    } finally {
      answer.resolve();
      await acp.close();
      await prompt;
    }
  });

  it.each(["human.ask", "connection.call"])(
    "aborts and joins pending %s work on close while steer and Stop stay responsive",
    async (name) => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let active = 0;
      let aborted = false;
      const session = await open({
        onOutput: async () => {},
        handleTool: async (_, signal) => {
          active++;
          entered.resolve();
          try {
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  resolve();
                },
                { once: true },
              );
              void release.promise.then(resolve);
            });
            // close must join cleanup too, not just signal the task.
            await Bun.sleep(10);
            throw new Error("cancelled pending human decision");
          } finally {
            active--;
          }
        },
      });
      try {
        await session.tool("pending", name);
        await entered.promise;
        const start = performance.now();
        await promptly(session.acp.steer("continue"));
        expect(active).toBe(1);
        expect(session.received.some((m) => m.id === "pending")).toBe(false);
        if (name === "human.ask") await promptly(session.acp.cancel());
        await promptly(session.acp.close());
        expect(aborted).toBe(true);
        expect(active).toBe(0);
        expect(session.received.some((m) => m.id === "pending")).toBe(false);
        expect(
          session.received.some((m) => m.method === "session/cancel"),
        ).toBe(name === "human.ask");
        expect(await session.prompt).toHaveProperty("error");
        console.log(
          JSON.stringify({
            tool: name,
            steerCancelCloseMs: Math.round(performance.now() - start),
            activeAfterClose: active,
            aborted,
          }),
        );
      } finally {
        release.resolve();
        await session.acp.close();
        await session.prompt;
      }
    },
  );

  it("keeps tool replies and output chunks ordered, with session checks before invocation", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const called: unknown[] = [];
    const output: string[] = [];
    const session = await open({
      onOutput: async (text) => {
        await Bun.sleep(5);
        output.push(text);
      },
      handleTool: async (input) => {
        called.push(input);
        if (called.length === 1) {
          entered.resolve();
          await release.promise;
        }
        return { ok: true };
      },
    });
    try {
      await session.tool("first");
      await entered.promise;
      await session.tool("wrong", "human.ask", "other-session");
      await session.tool("second", "connection.call");
      for (const text of ["one", "two"])
        await session.emit({
          method: "session/update",
          params: {
            sessionId: "session",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text },
            },
          },
        });
      await promptly(session.acp.steer("continue"));
      expect(output).toEqual(["one", "two"]);
      expect(called).toEqual([{ name: "human.ask" }]);
      release.resolve();
      await expect
        .poll(
          () => session.received.filter((m) => typeof m.id === "string").length,
        )
        .toBe(3);
      const replies = session.received.filter((m) => typeof m.id === "string");
      expect(replies.map((m) => m.id)).toEqual(["first", "wrong", "second"]);
      expect(replies[1]?.error).toMatchObject({ code: -32603 });
      expect(called).toEqual([
        { name: "human.ask" },
        { name: "connection.call" },
      ]);
    } finally {
      release.resolve();
      await session.acp.close();
      await session.prompt;
    }
  });

  it("bounds queued tools and aborts the running callback without invoking overflow work", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let calls = 0;
    let active = 0;
    const session = await open({
      onOutput: async () => {},
      handleTool: async (_, signal) => {
        calls++;
        active++;
        entered.resolve();
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
          void release.promise.then(resolve);
        });
        active--;
      },
    });
    try {
      await session.tool("first");
      await entered.promise;
      for (let i = 1; i <= 8; i++) await session.tool(`queued-${i}`);
      expect(await promptly(session.prompt)).toMatchObject({
        error: { message: "ACP tool limit" },
      });
      await promptly(session.acp.close());
      expect(calls).toBe(1);
      expect(active).toBe(0);
    } finally {
      release.resolve();
      await session.acp.close();
      await session.prompt;
    }
  });

  it("aborts pending work on stream EOF and joins it on close", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let aborted = false;
    const session = await open({
      onOutput: async () => {},
      handleTool: async (_, signal) => {
        entered.resolve();
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
          void release.promise.then(resolve);
        });
      },
    });
    try {
      await session.tool("question");
      await entered.promise;
      await session.end();
      expect(await promptly(session.prompt)).toMatchObject({
        error: { message: "ACP stream closed" },
      });
      await promptly(session.acp.close());
      expect(aborted).toBe(true);
    } finally {
      release.resolve();
      await session.acp.close();
      await session.prompt;
    }
  });

  it("observes a tool reply write failure in the pending prompt and close", async () => {
    const wire = peer();
    const write = wire.process.write;
    wire.process.write = async (bytes) => {
      const message = frame.parse(JSON.parse(new TextDecoder().decode(bytes)));
      if (message.id === "failed-reply")
        throw new Error("controlled write failure");
      await write(bytes);
    };
    const acp = connectAcp(wire.process, {
      onOutput: async () => {},
      handleTool: async () => {
        throw new Error("denied");
      },
    });
    await acp.initialize();
    await acp.openSession(null, "fixture");
    const prompt = acp.prompt("work", 20000).catch((error: unknown) => error);
    try {
      await wire.emit({
        id: "failed-reply",
        method: "_otto/tool",
        params: { sessionId: "session", input: {} },
      });
      expect(await promptly(prompt)).toMatchObject({
        message: "controlled write failure",
      });
    } finally {
      await expect(acp.close()).rejects.toThrow("controlled write failure");
      await prompt;
    }
  });

  it("joins cancelled tool work before a native prompt completion can release the attempt", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let active = 0;
    const session = await open({
      onOutput: async () => {},
      handleTool: async (_, signal) => {
        active++;
        entered.resolve();
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
          void release.promise.then(resolve);
        });
        await Bun.sleep(10);
        active--;
        return { answer: "cancelled" };
      },
    });
    try {
      await session.tool("pending");
      await entered.promise;
      const promptId = session.received.find(
        (m) => m.method === "session/prompt",
      )?.id;
      expect(promptId).toBeTypeOf("number");
      await session.emit({ id: promptId, result: { stopReason: "end_turn" } });
      expect(await promptly(session.prompt)).toEqual({ value: "end_turn" });
      expect(active).toBe(0);
      expect(session.received.some((m) => m.id === "pending")).toBe(false);
    } finally {
      release.resolve();
      await session.acp.close();
      await session.prompt;
    }
  });

  it("rejects completion within the cleanup deadline when a tool ignores abort", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let active = 0;
    let signal: AbortSignal | undefined;
    const session = await open({
      onOutput: async () => {},
      handleTool: async (_, currentSignal) => {
        signal = currentSignal;
        active++;
        entered.resolve();
        await release.promise;
        active--;
      },
    });
    try {
      await session.tool("uncooperative");
      await entered.promise;
      const promptId = session.received.find(
        (m) => m.method === "session/prompt",
      )?.id;
      const started = performance.now();
      await session.emit({ id: promptId, result: { stopReason: "end_turn" } });
      expect(await session.prompt).toMatchObject({
        error: { message: "ACP tool cleanup timeout" },
      });
      expect(performance.now() - started).toBeLessThan(6000);
      expect(signal?.aborted).toBe(true);
      expect(active).toBe(1);
      console.log(
        JSON.stringify({
          ignoredAbort: true,
          completion: "rejected: ACP tool cleanup timeout",
          elapsedMs: Math.round(performance.now() - started),
        }),
      );
    } finally {
      release.resolve();
      await promptly(session.acp.close());
      expect(active).toBe(0);
      expect(session.received.some((m) => m.id === "uncooperative")).toBe(
        false,
      );
      await session.prompt;
    }
  });

  it("retains the failed close outcome when tool cancellation is ignored", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const session = await open({
      onOutput: async () => {},
      handleTool: async () => {
        entered.resolve();
        await release.promise;
        finished.resolve();
      },
    });
    try {
      await session.tool("uncooperative");
      await entered.promise;
      const first = session.acp.close();
      expect(session.acp.close()).toBe(first);
      await expect(first).rejects.toThrow("ACP tool cleanup timeout");
      await expect(session.acp.close()).rejects.toThrow(
        "ACP tool cleanup timeout",
      );
      expect(await session.prompt).toMatchObject({
        error: { message: "ACP tool cleanup timeout" },
      });
    } finally {
      release.resolve();
      await promptly(finished.promise);
      await expect(session.acp.close()).rejects.toThrow(
        "ACP tool cleanup timeout",
      );
      await session.prompt;
    }
  });
});
