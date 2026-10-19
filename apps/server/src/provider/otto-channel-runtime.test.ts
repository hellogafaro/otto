import {
  BotId,
  GroupId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@otto/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createOttoChannelRuntime } from "./otto-channel-runtime.ts";

const now = "2026-09-01T00:00:00.000Z";

const bossBotId = BotId.make("boss");

const specialistBotId = BotId.make("specialist");

const channelId = GroupId.make("channel-1");

const threadId = ThreadId.make("thread-1");

const messageId = MessageId.make("message-1");

const bot = (id: BotId, groupId: GroupId | null) => ({
  id,
  name: id,
  title: id,
  label: null,
  description: null,
  instructions: null,
  disabledMcpServerIds: [],
  avatar: { kind: "dither" as const, seed: id },
  engine: null,
  sandbox: "local" as const,
  runtimeMode: "approval-required" as const,
  imageProvider: null,
  sandboxSize: null,
  voiceEnabled: false,
  channelBindings: [],
  groupId,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
});

const snapshot: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
  bots: [bot(bossBotId, channelId), bot(specialistBotId, channelId)],
  groups: [
    {
      id: channelId,
      name: "Launch",
      bossBotId,
      members: [
        { kind: "bot", botId: bossBotId, role: "boss" },
        { kind: "bot", botId: specialistBotId, role: "specialist" },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ],
  delegations: [],
  threads: [],
  updatedAt: now,
};

const snapshotWithMessage = (reacted = false): OrchestrationReadModel => ({
  ...snapshot,
  threads: [
    {
      id: threadId,
      projectId: ProjectId.make("project-1"),
      botId: null,
      groupId: channelId,
      respondingBotId: bossBotId,
      title: "Launch",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
      messages: [
        {
          id: messageId,
          role: "user",
          text: "Ship it",
          turnId: null,
          reactions: reacted ? [{ botId: bossBotId, emoji: "👍" }] : [],
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
});

describe("OttoChannelRuntime", () => {
  it("adds reactions once and keeps retries idempotent", async () => {
    const dispatch = vi.fn();

    const readThread = vi
      .fn()
      .mockResolvedValueOnce(snapshotWithMessage().threads[0])
      .mockResolvedValue(snapshotWithMessage(true).threads[0]);

    const runtime = createOttoChannelRuntime({
      readSnapshot: async () => snapshot,
      readThread,
      dispatch,
      now: () => now,
    });

    const input = { messageId, emoji: "👍", action: "add" as const };

    await expect(
      runtime.react(threadId, bossBotId, input, "reaction-add-1"),
    ).resolves.toMatchObject({
      status: "applied",
      changed: true,
    });
    await expect(
      runtime.react(threadId, bossBotId, input, "reaction-add-1"),
    ).resolves.toMatchObject({
      status: "applied",
      changed: false,
    });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("dispatches a new command when a removed reaction is added again", async () => {
    const dispatch = vi.fn();

    const readSnapshot = vi
      .fn<() => Promise<OrchestrationReadModel>>()
      .mockResolvedValueOnce({ ...snapshot, snapshotSequence: 1 })
      .mockResolvedValueOnce({ ...snapshot, snapshotSequence: 2 })
      .mockResolvedValueOnce({ ...snapshot, snapshotSequence: 3 });

    const readThread = vi
      .fn()
      .mockResolvedValueOnce(snapshotWithMessage().threads[0])
      .mockResolvedValueOnce(snapshotWithMessage(true).threads[0])
      .mockResolvedValueOnce(snapshotWithMessage().threads[0]);

    const runtime = createOttoChannelRuntime({
      readSnapshot,
      readThread,
      dispatch,
      now: () => now,
    });

    await runtime.react(
      threadId,
      bossBotId,
      { messageId, emoji: "👍", action: "add" },
      "reaction-add-1",
    );
    await runtime.react(
      threadId,
      bossBotId,
      { messageId, emoji: "👍", action: "remove" },
      "reaction-remove-1",
    );
    await runtime.react(
      threadId,
      bossBotId,
      { messageId, emoji: "👍", action: "add" },
      "reaction-add-1",
    );

    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(new Set(dispatch.mock.calls.map(([command]) => command.commandId)).size).toBe(3);
  });

  it("returns a typed unsupported result and rejects invisible messages", async () => {
    const dispatch = vi.fn();

    const unsupported = createOttoChannelRuntime({
      readSnapshot: async () => snapshotWithMessage(),
      dispatch,
      supportsReactions: () => false,
    });

    await expect(
      unsupported.react(
        threadId,
        bossBotId,
        { messageId, emoji: "👍", action: "add" },
        "reaction-unsupported",
      ),
    ).resolves.toEqual({
      status: "unsupported",
      messageId,
      reason: "channel-does-not-support-reactions",
    });

    const hidden = createOttoChannelRuntime({
      readSnapshot: async () => snapshotWithMessage(),
      dispatch,
    });

    await expect(
      hidden.react(
        threadId,
        BotId.make("outsider"),
        {
          messageId,
          emoji: "👍",
          action: "add",
        },
        "reaction-hidden",
      ),
    ).rejects.toThrow("not visible");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
