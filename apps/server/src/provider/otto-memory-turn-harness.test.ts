import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { BotId } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { BotMemoryStore } from "../memory/bot-memory.ts";
import type { OttoMemoryToolHandler } from "../memory/bot-memory-tool-handlers.ts";
import { OttoMemoryTurnHarness } from "./otto-memory-turn-harness.ts";

describe("OttoMemoryTurnHarness", () => {
  it.each([0, 1, 2])(
    "settles every foreground provider by the same exact-call contract (count: %s)",
    async (successfulCalls) => {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-turn-harness-"));
      const store = new BotMemoryStore(root);
      const botId = BotId.make(`bot-turn-harness-${successfulCalls}`);
      const access = { botId, groupId: null, groupMemberBotIds: [] } as const;

      try {
        for (let prompt = 0; prompt < 10; prompt += 1) {
          const seed = await store.reserveReviewCadence(botId, {
            threadId: "seed",
            groupId: null,
            text: `Seed ${prompt}`,
          });

          await store.settleReviewCadence(seed, true);
        }

        const turn = await new OttoMemoryTurnHarness(store).admit({
          access,
          input: {
            threadId: "current",
            groupId: null,
            text: "I like cats.",
          },
        });

        expect(turn.reviewIncluded).toBe(true);
        expect(turn.context).toContain("<automatic-memory-review>");
        const handler: OttoMemoryToolHandler = async () => ({ success: true });
        const tracked = turn.wrapMemoryHandler(handler);

        for (let call = 0; call < successfulCalls; call += 1) {
          await tracked({
            threadId: "current",
            toolId: "memory",
            toolCallId: `call-${call}`,
            input: { target: "user", operations: [] },
            approvalMode: "require-grant",
          });
        }

        await turn.finishForeground(true, "foreground");
        expect(await store.readReviewCadence(botId)).toEqual({
          acceptedPromptCount: 11,
          reviewedThroughPromptCount: successfulCalls === 1 ? 10 : 0,
          dueOnNextAcceptedPrompt: successfulCalls !== 1,
        });
      } finally {
        NodeFS.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("uses the same lifecycle for a deferred review", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-deferred-harness-"));
    const store = new BotMemoryStore(root);
    const botId = BotId.make("bot-deferred-harness");

    try {
      for (let prompt = 0; prompt < 10; prompt += 1) {
        const seed = await store.reserveReviewCadence(botId);
        await store.settleReviewCadence(seed, true);
      }

      const turn = await new OttoMemoryTurnHarness(store).admit({
        access: { botId, groupId: null, groupMemberBotIds: [] },
        input: { threadId: "current", groupId: null, text: "Remember cats." },
      });

      const tracked = turn.wrapMemoryHandler(async () => ({ success: true }));
      await turn.finishForeground(true, "deferred");
      expect((await store.readReviewCadence(botId)).reviewedThroughPromptCount).toBe(0);
      await tracked({
        threadId: "hidden",
        toolId: "memory",
        toolCallId: "hidden-call",
        input: { target: "user", operations: [] },
        approvalMode: "require-grant",
      });
      await turn.finishDeferredReview(true);
      expect((await store.readReviewCadence(botId)).reviewedThroughPromptCount).toBe(10);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("releases a review claim when the turn scope closes", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-scope-close-"));
    const store = new BotMemoryStore(root);
    const botId = BotId.make("bot-scope-close");

    try {
      for (let prompt = 0; prompt < 10; prompt += 1) {
        const seed = await store.reserveReviewCadence(botId);
        await store.settleReviewCadence(seed, true);
      }

      const turn = await new OttoMemoryTurnHarness(store).admit({
        access: { botId, groupId: null, groupMemberBotIds: [] },
        input: { threadId: "current", groupId: null, text: "Remember cats." },
      });

      await turn.close();
      const retry = await new BotMemoryStore(root).reserveReviewCadence(botId);
      expect(retry.memoryReviewIncluded).toBe(true);
      await new BotMemoryStore(root).settleReviewCadence(retry, false);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("releases a review claim when admission cannot read memory", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-admission-harness-"));
    const store = new BotMemoryStore(root);
    const botId = BotId.make("bot-admission-harness");

    try {
      for (let prompt = 0; prompt < 10; prompt += 1) {
        const seed = await store.reserveReviewCadence(botId);
        await store.settleReviewCadence(seed, true);
      }

      store.readPromptSnapshot = async () => {
        throw new Error("memory unavailable");
      };

      await expect(
        new OttoMemoryTurnHarness(store).admit({
          access: { botId, groupId: null, groupMemberBotIds: [] },
          input: { threadId: "current", groupId: null, text: "Remember cats." },
        }),
      ).rejects.toThrow("memory unavailable");

      const retry = await new BotMemoryStore(root).reserveReviewCadence(botId);
      expect(retry.memoryReviewIncluded).toBe(true);
      await new BotMemoryStore(root).settleReviewCadence(retry, false);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});
