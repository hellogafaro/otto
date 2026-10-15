interface NestedInput {
  nested?: NestedInput;
}

import { describe, expect, it } from "vite-plus/test";

import { ottoActionNeedsApproval, criticalOttoAction } from "./otto-mastra-harness.ts";

describe("Otto action inspection budget", () => {
  it("requires approval for large object arrays without overflowing the stack", () => {
    const args = Array.from({ length: 200_000 }, () => ({ operation: "read" }));

    expect(criticalOttoAction("custom_tool", args)).toBeNull();
    expect(ottoActionNeedsApproval("custom_tool", args)).toBe(true);
  });

  it("requires approval when a wide object exceeds the property budget", () => {
    const args = Object.fromEntries(
      Array.from({ length: 200_000 }, (_, index) => [`field${index}`, "read"]),
    );

    expect(ottoActionNeedsApproval("custom_tool", args)).toBe(true);
  });

  it("counts containers separately from primitive entries", () => {
    const args = { items: Array.from({ length: 60 }, () => ({ operation: "read" })) };

    expect(ottoActionNeedsApproval("custom_tool", args)).toBe(false);
  });

  it("permits a modest read-only batch", () => {
    const args = { ids: Array.from({ length: 100 }, (_, index) => String(index)) };

    expect(ottoActionNeedsApproval("custom_read", args)).toBe(false);
  });

  it("fails closed on cycles", () => {
    const args: NestedInput = {};
    args.nested = args;

    expect(ottoActionNeedsApproval("custom_tool", args)).toBe(true);
  });

  it("still classifies ordinary nested sensitive paths and commands", () => {
    expect(criticalOttoAction("custom_tool", { items: [{ path: "~/.ssh/id_rsa" }] })).toBe(
      "secrets",
    );
    expect(criticalOttoAction("custom_tool", { nested: { command: "git push origin main" } })).toBe(
      "publish",
    );
    expect(
      ottoActionNeedsApproval("custom_tool", { nested: { operation: "read", path: "README.md" } }),
    ).toBe(false);
  });
});
