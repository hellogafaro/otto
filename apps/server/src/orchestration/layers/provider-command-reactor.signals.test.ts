import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProviderInstanceId,
  ThreadId,
} from "@otto/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  asMessageId,
  asTurnId,
  createProviderCommandHarness,
} from "./test-support/provider-command-harness.ts";

const now = "2026-01-01T00:00:00.000Z";

const sendWhileRunning = (text: string) => ({
  type: "thread.turn.start" as const,
  commandId: CommandId.make(`cmd-${text}`),
  threadId: ThreadId.make("thread-1"),
  message: {
    messageId: asMessageId(`message-${text}`),
    role: "user" as const,
    text,
    attachments: [],
  },
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  runtimeMode: "approval-required" as const,
  createdAt: now,
});

const markRunning = {
  type: "thread.session.set" as const,
  commandId: CommandId.make("cmd-session-running"),
  threadId: ThreadId.make("thread-1"),
  session: {
    threadId: ThreadId.make("thread-1"),
    status: "running" as const,
    providerName: "codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    runtimeMode: "approval-required" as const,
    mcpServerIds: [],
    activeTurnId: asTurnId("turn-running"),
    lastError: null,
    updatedAt: now,
  },
  createdAt: now,
};

describe("ProviderCommandReactor signals", () => {
  const testScope = createProviderCommandHarness();
  const { createHarness } = testScope;
  afterEach(testScope.dispose);

  it("adds a message sent while the bot works to its running turn", async () => {
    const harness = await createHarness({ signalTurnDelivers: true });

    await harness.run(harness.engine.dispatch(markRunning));
    await harness.drain();
    const turnsBefore = harness.sendTurn.mock.calls.length;

    await harness.run(harness.engine.dispatch(sendWhileRunning("use Madrid instead")));
    await harness.drain();

    expect(harness.signalTurn).toHaveBeenCalledWith({
      threadId: ThreadId.make("thread-1"),
      input: "use Madrid instead",
      attachments: [],
    });
    expect(harness.sendTurn.mock.calls.length).toBe(turnsBefore);

    const thread = (await harness.readModel()).threads.find((entry) => entry.id === "thread-1");
    expect(thread?.session?.status).toBe("running");
    expect(thread?.session?.activeTurnId).toBe(asTurnId("turn-running"));
  });

  it("starts a turn when the running bot cannot take the message", async () => {
    const harness = await createHarness();

    await harness.run(harness.engine.dispatch(markRunning));
    await harness.drain();
    const turnsBefore = harness.sendTurn.mock.calls.length;

    await harness.run(harness.engine.dispatch(sendWhileRunning("are you there")));
    await harness.waitFor(() => harness.sendTurn.mock.calls.length === turnsBefore + 1);

    expect(harness.signalTurn).toHaveBeenCalledOnce();
    expect(harness.sendTurn.mock.calls.at(-1)?.[0]).toMatchObject({ input: "are you there" });
  });

  it("starts a turn without signalling when the bot is idle", async () => {
    const harness = await createHarness({ signalTurnDelivers: true });

    await harness.run(harness.engine.dispatch(sendWhileRunning("hello")));
    await harness.waitFor(() => harness.sendTurn.mock.calls.length === 1);

    expect(harness.signalTurn).not.toHaveBeenCalled();
  });
});
