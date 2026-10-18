import type { Notification } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { arrivedNotifications } from "./notification-alerts.logic";

const notification = (id: string, readAt: string | null = null) =>
  // SAFETY: the rule reads only ids and read times; the other fields are fixed fixtures.
  ({
    id,
    type: "assigned",
    actor: null,
    entityType: "task",
    entityId: "task-1",
    title: "Fix login",
    excerpt: "",
    createdAt: "2026-10-18T09:00:00.000Z",
    readAt,
  }) as Notification;

describe("arrivedNotifications", () => {
  it("alerts nothing on the first look", () => {
    expect(arrivedNotifications(null, [notification("a")])).toEqual([]);
  });

  it("alerts only unread notifications it has not seen", () => {
    const fresh = notification("c");

    expect(
      arrivedNotifications(new Set(["a"]), [
        fresh,
        notification("b", "2026-10-18T09:05:00.000Z"),
        notification("a"),
      ]),
    ).toEqual([fresh]);
  });
});
