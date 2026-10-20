import {
  THREAD_SILENT_RUN_ACTIVITY_KIND,
  THREAD_SILENT_RUN_CLEARED_ACTIVITY_KIND,
} from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isSilentRunActivity } from "./silent-run.ts";

describe("isSilentRunActivity", () => {
  it("identifies silent-run activities for work log filtering", () => {
    expect(isSilentRunActivity({ kind: THREAD_SILENT_RUN_ACTIVITY_KIND })).toBe(true);
    expect(isSilentRunActivity({ kind: THREAD_SILENT_RUN_CLEARED_ACTIVITY_KIND })).toBe(true);
    expect(isSilentRunActivity({ kind: "tool.started" })).toBe(false);
  });
});
