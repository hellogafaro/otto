import { CommandId, TaskId } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { withOrganizationTimeZone } from "./task-time-zone.ts";

describe("withOrganizationTimeZone", () => {
  it("counts task days in the organization's zone, whatever the device sent", () => {
    const taskId = TaskId.make("task-1");

    expect(
      withOrganizationTimeZone(
        {
          type: "task.update",
          commandId: CommandId.make("update"),
          taskId,
          status: "completed",
          timezone: "Pacific/Kiritimati",
        },
        "Europe/Madrid",
      ),
    ).toMatchObject({ timezone: "Europe/Madrid" });

    expect(
      withOrganizationTimeZone(
        {
          type: "task.time.create",
          commandId: CommandId.make("time"),
          taskId,
          entryId: "entry-1",
          duration: 60_000,
          createdAt: "2026-10-20T00:00:00.000Z",
        },
        "Europe/Madrid",
      ),
    ).toMatchObject({ timezone: "Europe/Madrid" });

    const deletion = { type: "task.delete" as const, commandId: CommandId.make("delete"), taskId };

    expect(withOrganizationTimeZone(deletion, "Europe/Madrid")).toBe(deletion);
  });
});
