import { describe } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Memory } from "@mastra/memory";
import * as DateTime from "effect/DateTime";
import { it } from "@effect/vitest";
import { expect, vi } from "vite-plus/test";
import { makeOttoMastraHarnessTestSupport } from "./test-support/otto-mastra-harness.ts";

const { harnessTest, makeHarness } = makeOttoMastraHarnessTestSupport();

describe("OttoMastraHarness", () => {
  it.effect("restores original history when rebuilding a conversation fails", () =>
    harnessTest(async (open) => {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-rebuild-"));
      const harness = await makeHarness(open, directory);
      const threadId = "rebuild-history";

      const messages = [1, 2].map((count) => ({
        id: `message-${count}`,
        role: "user" as const,
        content: { format: 2 as const, parts: [{ type: "text" as const, text: `Turn ${count}` }] },
        createdAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
        threadId,
        resourceId: threadId,
      }));

      let persist: ReturnType<typeof vi.spyOn> | undefined;

      try {
        await harness.controller.init();
        await harness.rebuildConversation!(threadId, messages);
        persist = vi
          .spyOn(Memory.prototype, "persistMessages")
          .mockRejectedValueOnce(new Error("Persistence failed"));
        await expect(harness.rebuildConversation!(threadId, messages.slice(0, 1))).rejects.toThrow(
          "Persistence failed",
        );
        const session = await harness.controller.createSession({ resourceId: threadId, threadId });
        expect((await session.thread.listActiveMessages()).map((message) => message.id)).toEqual([
          "message-1",
          "message-2",
        ]);
      } finally {
        persist?.mockRestore();
        await harness.close();
        NodeFS.rmSync(directory, { recursive: true, force: true });
      }
    }),
  );
});
