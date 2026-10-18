import { Match } from "effect";
import { ThreadId } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";
import { buildThreadListV2Items, buildThreadListV2ListItems } from "./threadListV2";
import { NOW, makePendingTask, makeThread } from "./threadListV2.test-support";

describe("buildThreadListV2ListItems", () => {
  const layout = buildThreadListV2Items({
    threads: [makeThread({ id: ThreadId.make("active"), title: "active" })],
    environmentId: null,
    searchQuery: "",
    now: NOW,
  });

  it("splices queued tasks after the active block", () => {
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [makePendingTask("queued-1"), makePendingTask("queued-2")],
    });

    expect(
      items.map((item) =>
        Match.value(item).pipe(
          Match.when({ type: "v2-pending" }, (item) => item.pendingTask.title),
          Match.when({ type: "v2-thread" }, (item) => item.item.thread.id),
          Match.orElse(() => "snoozed-shelf"),
        ),
      ),
    ).toEqual(["active", "queued-1", "queued-2"]);
    // Only the leading queued row labels the section.
    expect(
      items.filter((item) => item.type === "v2-pending" && item.showPendingDivider),
    ).toHaveLength(1);
  });

  it("places queued tasks before a collapsed snoozed shelf", () => {
    const snoozedLayout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "active" }),
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    const items = buildThreadListV2ListItems({
      items: snoozedLayout.items,
      pendingTasks: [makePendingTask("queued")],
      snoozedCount: snoozedLayout.snoozedCount,
      snoozedShelfExpanded: false,
      snoozedShelfHeaderIndex: snoozedLayout.snoozedShelfHeaderIndex,
    });

    expect(items.map((item) => item.type)).toEqual(["v2-thread", "v2-pending", "v2-snoozed-shelf"]);
  });
});
