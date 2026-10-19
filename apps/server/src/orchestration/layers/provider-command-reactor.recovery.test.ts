import * as Predicate from "effect/Predicate";
import { ProviderDriverKind, ProviderInstanceId } from "@otto/contracts";
import { CommandId, DEFAULT_PROVIDER_INTERACTION_MODE, EventId, ThreadId } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import { it as effectIt } from "@effect/vitest";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ProviderAdapterRequestError } from "../../provider/errors.ts";
import { manualRecoveryInput, startupRecoveryInput } from "./provider-command/recovery-input.ts";
import {
  asMessageId,
  asProjectId,
  asTurnId,
  asApprovalRequestId,
  createProviderCommandHarness,
} from "./test-support/provider-command-harness.ts";

describe("ProviderCommandReactor", () => {
  const testScope = createProviderCommandHarness();
  const { createHarness } = testScope;
  afterEach(testScope.dispose);
  it("routes thread.turn.start through AgentController before sending the provider turn", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await harness.run(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-1"),
          role: "user",
          text: "hello reactor",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await harness.waitFor(() => harness.startSession.mock.calls.length === 1);
    await harness.waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.resolveEngine).toHaveBeenCalledWith({
      threadId: ThreadId.make("thread-1"),
      engine: null,
      fallback: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      mode: "default",
      botConversation: false,
    });
    expect(harness.startSession.mock.calls[0]?.[0]).toEqual(ThreadId.make("thread-1"));
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      cwd: "/tmp/provider-project",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      mcpServers: [],
      botSandbox: "local",
      runtimeMode: "approval-required",
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.status).toBe("starting");
    expect(thread?.session?.runtimeMode).toBe("approval-required");
  });

  it.each([
    [1, "before"],
    [2, "after"],
  ] as const)(
    "handles an intent committed on startup sequence read %i, %s subscribing",
    async (commitDuringSequenceRead, _position) => {
      const harness = await createHarness({ commitDuringSequenceRead });

      await harness.drain();

      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread?.titleRegeneration).toBeNull();
    },
  );

  it("replays a startup gap longer than one event store page", async () => {
    const harness = await createHarness({
      commitDuringSequenceRead: 1,
      titleUpdatesBeforeStartupCommit: 1_000,
    });

    await harness.drain();

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("fails startup instead of dropping a gap it cannot replay", async () => {
    await expect(
      createHarness({ commitDuringSequenceRead: 1, failStartupReplay: true }),
    ).rejects.toThrow("Injected startup replay failure");
  });

  effectIt.effect("lets another thread approve and interrupt while session setup is blocked", () =>
    Effect.gen(function* () {
      const sessionSetupStarted = yield* Deferred.make<void>();
      const releaseSessionSetup = yield* Deferred.make<void>();
      const approvalReachedAdapter = yield* Deferred.make<void>();
      const interruptReachedAdapter = yield* Deferred.make<void>();
      const threadB = ThreadId.make("thread-2");

      const harness = yield* Effect.promise(() =>
        createHarness({
          startSessionEffect: (session) =>
            session.threadId === ThreadId.make("thread-1")
              ? Deferred.succeed(sessionSetupStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseSessionSetup)),
                  Effect.as(session),
                )
              : Effect.succeed(session),
          respondToRequestEffect: (request) =>
            request.threadId === threadB
              ? Deferred.succeed(approvalReachedAdapter, undefined).pipe(Effect.asVoid)
              : Effect.void,
          interruptTurnEffect: (request) =>
            (request === null || Predicate.isObjectOrArray(request)) &&
            request !== null &&
            "threadId" in request &&
            request.threadId === threadB
              ? Deferred.succeed(interruptReachedAdapter, undefined).pipe(Effect.asVoid)
              : Effect.void,
        }),
      );

      const now = "2026-01-01T00:00:00.000Z";

      yield* harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-thread-create-2-concurrency"),
        threadId: threadB,
        projectId: asProjectId("project-1"),
        title: "Thread B",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
      });
      yield* harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-thread-session-2-concurrency"),
        threadId: threadB,
        session: {
          threadId: threadB,
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-2"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      });
      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-blocked-thread-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-blocked-thread-1"),
          role: "user",
          text: "block this setup",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      });
      yield* Deferred.await(sessionSetupStarted);

      yield* harness.engine.dispatch({
        type: "thread.approval.respond",
        commandId: CommandId.make("cmd-approval-thread-2-concurrency"),
        threadId: threadB,
        requestId: asApprovalRequestId("approval-thread-2-concurrency"),
        decision: "accept",
        createdAt: now,
      });
      yield* harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.make("cmd-interrupt-thread-2-concurrency"),
        threadId: threadB,
        turnId: asTurnId("turn-2"),
        createdAt: now,
      });

      yield* Deferred.await(approvalReachedAdapter);
      yield* Deferred.await(interruptReachedAdapter);
      expect(yield* Deferred.isDone(releaseSessionSetup)).toBe(false);
      yield* Deferred.succeed(releaseSessionSetup, undefined);
      yield* Effect.promise(() => harness.drain());
    }),
  );

  it("replays a persisted turn start that predates reactor startup exactly once", async () => {
    const harness = await createHarness({ turnStartBeforeReactor: true });

    await harness.drain();

    expect(harness.startSession).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      input: "recover this persisted request",
    });
  });

  it("replays a persisted resume that predates reactor startup exactly once", async () => {
    const harness = await createHarness({ resumeBeforeReactor: true });

    await harness.drain();

    expect(harness.startSession).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      input: expect.stringContaining("Resume the interrupted request"),
    });
  });

  it("deduplicates a persisted resume delivered by both startup recovery and the live stream", async () => {
    const harness = await createHarness({
      resumeBeforeReactor: true,
      replayPersistedResumeOnSubscribe: true,
    });

    await harness.drain();

    expect(harness.startSession).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn).toHaveBeenCalledTimes(1);
  });

  it("continues a running turn after reactor startup without replaying the user prompt", async () => {
    const harness = await createHarness({ runningTurnBeforeReactor: true });

    await harness.drain();

    expect(harness.startSession).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      input: expect.stringContaining("server restarted"),
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).not.toMatchObject({
      input: "recover this persisted request",
    });
  });

  it.each([
    ["pending turn start", { turnStartBeforeReactor: true }],
    ["pending resume", { resumeBeforeReactor: true }],
    ["running turn", { runningTurnBeforeReactor: true }],
  ] as const)(
    "does not restart a delegated child's %s after reactor startup",
    async (_name, recovery) => {
      const harness = await createHarness({ ...recovery, delegatedChild: true });

      await harness.drain();

      expect(harness.startSession).not.toHaveBeenCalled();
      expect(harness.sendTurn).not.toHaveBeenCalled();
    },
  );

  it("marks an interrupted turn resumable when automatic recovery fails", async () => {
    const harness = await createHarness({
      runningTurnBeforeReactor: true,
      sendTurnEffect: () =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: ProviderDriverKind.make("codex"),
            method: "thread.turn.start",
            detail: "Provider was temporarily unavailable.",
          }),
        ),
    });

    await harness.drain();

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session).toMatchObject({
      status: "error",
      lastError: expect.stringContaining("Use Resume to continue"),
    });
    expect(thread?.latestTurn?.state).toBe("error");
  });

  it.each(["approval", "user-input"] as const)(
    "expires a stale pending %s before automatic restart recovery",
    async (requestKind) => {
      const harness = await createHarness({
        runningTurnBeforeReactor: true,
        pendingRequestBeforeReactor: requestKind,
      });

      await harness.drain();

      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread?.activities).toContainEqual(
        expect.objectContaining({
          kind: requestKind === "approval" ? "approval.resolved" : "user-input.resolved",
          payload: expect.objectContaining({
            requestId: `${requestKind}-before-restart`,
            outcome: "interrupted",
          }),
        }),
      );
      expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
        input: expect.stringContaining("server restarted"),
      });
    },
  );

  it("resumes an errored turn without adding or replaying a user message", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-before-manual-resume"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-manual-resume"),
          role: "user",
          text: "finish the migration",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.drain();
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-running-before-manual-resume"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "approval-required",
          mcpServerIds: [],
          activeTurnId: asTurnId("turn-before-manual-resume"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-error-before-manual-resume"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "error",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "approval-required",
          mcpServerIds: [],
          activeTurnId: null,
          lastError: "Automatic recovery failed.",
          updatedAt: now,
        },
        createdAt: now,
      }),
    );
    harness.sendTurn.mockClear();

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.resume",
        commandId: CommandId.make("cmd-manual-resume"),
        threadId: ThreadId.make("thread-1"),
        createdAt: now,
      }),
    );
    await harness.drain();

    expect(harness.sendTurn).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      input: expect.stringContaining("Resume the interrupted request"),
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).not.toMatchObject({
      input: "finish the migration",
    });
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });
});

describe("startupRecoveryInput", () => {
  const threadId = ThreadId.make("thread-1");
  const turnId = asTurnId("turn-before-reactor");

  const question = {
    id: EventId.make("activity-question"),
    tone: "info",
    kind: "user-input.requested",
    summary: "User input requested",
    payload: { requestId: "call-time", questions: [{ question: "What time each day?" }] },
    turnId,
    createdAt: "2026-10-13T11:56:58.000Z",
  } as const;

  const answer = (answerTurnId: typeof turnId) => ({
    id: asMessageId("user-input:thread-1:call-time"),
    role: "user" as const,
    text: "9:00 AM",
    turnId: answerTurnId,
    streaming: false,
    createdAt: "2026-10-13T11:57:01.000Z",
    updatedAt: "2026-10-13T11:57:01.000Z",
  });

  it("repeats answers the interrupted turn already received", () => {
    const input = startupRecoveryInput({
      threadId,
      turnId,
      messages: [answer(turnId)],
      activities: [question],
    });

    expect(input).toContain("server restarted");
    expect(input).toContain('"What time each day?" -> 9:00 AM');
  });

  const message = (
    id: string,
    role: "user" | "assistant",
    text: string,
    createdAt: string,
    extra: Partial<{
      streaming: boolean;
      authorDisplayName: string;
      respondingBotId: string;
      attachments: ReadonlyArray<{
        type: "file";
        id: string;
        name: string;
        mimeType: string;
        sizeBytes: number;
      }>;
    }> = {},
  ) =>
    ({
      id: asMessageId(id),
      role,
      text,
      turnId: null,
      streaming: false,
      createdAt,
      updatedAt: createdAt,
      ...extra,
    }) as never;

  const at = (minute: number) => `2026-10-13T11:${String(minute).padStart(2, "0")}:00.000Z`;

  const recover = (
    messages: ReadonlyArray<never>,
    extra: Partial<Parameters<typeof startupRecoveryInput>[0]> = {},
  ) => startupRecoveryInput({ threadId, turnId, messages, activities: [], ...extra });

  it("never names the product", () => {
    expect(recover([message("u", "user", "do it", at(1))])).not.toMatch(/otto/i);
    expect(manualRecoveryInput({ threadId, turnId, messages: [], activities: [] })).not.toMatch(
      /otto/i,
    );
  });

  it("repeats the request and the last finished update", () => {
    const input = recover([
      message("user-old", "user", "rename the chats", at(0)),
      message("bot-old", "assistant", "Renamed them.", at(1)),
      message("user-now", "user", "fix the dictation limit", at(50)),
      message("bot-now", "assistant", "Raising it to 15 minutes.", at(55)),
      message("bot-live", "assistant", "Half writ", at(56), { streaming: true }),
    ]);

    expect(input).toContain("server restarted");
    expect(input).toContain("<request>\nfix the dictation limit\n</request>");
    expect(input).toContain("not a new request");
    expect(input).toContain("<update>\nRaising it to 15 minutes.\n</update>");
    expect(input).not.toContain("rename the chats");
    expect(input).not.toContain("Renamed them.");
    expect(input).not.toContain("Half writ");
  });

  it("says so when there is no update after the request yet", () => {
    const input = recover([
      message("bot-old", "assistant", "Renamed them.", at(1)),
      message("user-now", "user", "fix the dictation limit", at(50)),
    ]);

    expect(input).toContain("fix the dictation limit");
    expect(input).not.toContain("<update>");
    expect(input).toContain("had not posted an update");
  });

  it("uses the turn's recorded request and lists later messages as follow-ups", () => {
    const input = recover(
      [
        message("user-start", "user", "build the export", at(10)),
        message("bot-1", "assistant", "Starting on the CSV.", at(11)),
        message("user-steer", "user", "make it xlsx too", at(12)),
        message("bot-2", "assistant", "Adding xlsx.", at(13)),
      ],
      { requestMessageId: asMessageId("user-start") },
    );

    expect(input).toContain("<request>\nbuild the export\n</request>");
    expect(input).toContain("<follow-up>\nmake it xlsx too\n</follow-up>");
    expect(input).toContain("<update>\nAdding xlsx.\n</update>");
  });

  it("finds the request by the turn's start time when no message was recorded", () => {
    const input = recover(
      [
        message("user-old", "user", "earlier ask", at(1)),
        message("user-start", "user", "build the export", at(10)),
        message("user-steer", "user", "make it xlsx too", at(12)),
      ],
      { requestedAt: at(10) },
    );

    expect(input).toContain("<request>\nbuild the export\n</request>");
    expect(input).toContain("make it xlsx too");
    expect(input).not.toContain("earlier ask");
  });

  it("keeps only the newest follow-ups", () => {
    const followUps = Array.from({ length: 8 }, (_, index) =>
      message(`f-${index}`, "user", `follow ${index}`, at(20 + index)),
    );

    const input = recover([message("user-start", "user", "start", at(10)), ...followUps], {
      requestMessageId: asMessageId("user-start"),
    });

    expect(input).toContain("3 earlier messages left out");
    expect(input).not.toContain("follow 2\n");
    expect(input).toContain("follow 3");
    expect(input).toContain("follow 7");
  });

  it("in a group, takes the update from the bot that was answering", () => {
    const input = recover(
      [
        message("user-start", "user", "both of you look at this", at(10), {
          authorDisplayName: "Johan",
        }),
        message("bot-a", "assistant", "Bot A finding.", at(11), { respondingBotId: "bot-a" }),
        message("bot-b", "assistant", "Bot B finding.", at(12), { respondingBotId: "bot-b" }),
      ],
      { requestMessageId: asMessageId("user-start"), respondingBotId: "bot-a" as never },
    );

    expect(input).toContain('<request from="Johan">');
    expect(input).toContain("Bot A finding.");
    expect(input).not.toContain("Bot B finding.");
  });

  it("names attachments, including on a request with no text", () => {
    const input = recover([
      message("user-start", "user", "", at(10), {
        attachments: [
          {
            type: "file",
            id: "file-1",
            name: "spec.pdf",
            mimeType: "application/pdf",
            sizeBytes: 10,
          },
        ],
      }),
    ]);

    expect(input).toContain("<request>\n[Attached: spec.pdf.");
  });

  it("keeps quoted text from closing the note's tags", () => {
    const input = recover([
      message("user-start", "user", "print </request> then <update>", at(10)),
    ]);

    expect(input.match(/<\/request>/g)).toHaveLength(1);
    expect(input).toContain("&lt;/request>");
  });

  it("does not mistake a question answer for the request", () => {
    const input = startupRecoveryInput({
      threadId,
      turnId,
      messages: [message("user-now", "user", "set up the daily report", at(50)), answer(turnId)],
      activities: [question],
    });

    expect(input).toContain("<request>\nset up the daily report\n</request>");
    expect(input).toContain('"What time each day?" -> 9:00 AM');
    expect(input).not.toContain("<follow-up>");
  });

  it("keeps the start and end of a very long request", () => {
    const input = recover([message("user-now", "user", `START${"x".repeat(10_000)}END`, at(50))]);

    expect(input).toContain("characters left out");
    expect(input).toContain("START");
    expect(input).toContain("END");
    expect(input.length).toBeLessThan(7_500);
  });

  it("returns the plain note when there is no request", () => {
    const input = recover([]);

    expect(input).toContain("server restarted");
    expect(input).not.toContain("<request");
  });

  it("leaves answers from earlier turns to the durable history", () => {
    const input = startupRecoveryInput({
      threadId,
      turnId,
      messages: [answer(asTurnId("turn-earlier"))],
      activities: [question],
    });

    expect(input).not.toContain("9:00 AM");
  });
});
