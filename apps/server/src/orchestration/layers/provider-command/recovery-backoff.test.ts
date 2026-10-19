import { expect, it } from "vite-plus/test";

import {
  RECOVERY_BACKOFF_MS,
  RECOVERY_MAX_ATTEMPTS,
  countRecoveryAttempts,
  recoveryBackoffDelayMs,
  recoveryFailureDetail,
} from "./recovery-backoff.ts";

it("wakes immediately on the first attempt, then backs off", () => {
  expect(recoveryBackoffDelayMs(0)).toBe(0);
  expect(recoveryBackoffDelayMs(1)).toBe(15_000);
  expect(recoveryBackoffDelayMs(2)).toBe(30_000);
  expect(recoveryBackoffDelayMs(3)).toBe(60_000);
  expect(recoveryBackoffDelayMs(4)).toBe(120_000);
});

it("stops after the ladder, and rejects a bad attempt count", () => {
  expect(RECOVERY_MAX_ATTEMPTS).toBe(RECOVERY_BACKOFF_MS.length);
  expect(recoveryBackoffDelayMs(RECOVERY_MAX_ATTEMPTS)).toBeNull();
  expect(recoveryBackoffDelayMs(-1)).toBeNull();
  expect(recoveryBackoffDelayMs(1.5)).toBeNull();
});

it("counts only this turn's recovery attempts so a restart does not reset the ladder", () => {
  const activities = [
    { kind: "provider.recovery.attempt", turnId: "turn-1" },
    { kind: "provider.turn.start.failed", turnId: "turn-1" },
    { kind: "provider.recovery.attempt", turnId: "turn-2" },
    { kind: "provider.recovery.attempt", turnId: "turn-1" },
  ];

  expect(countRecoveryAttempts(activities, "turn-1")).toBe(2);
  expect(countRecoveryAttempts(activities, "turn-2")).toBe(1);
  expect(countRecoveryAttempts(activities, null)).toBe(3);
});

it("reads the error the next wake should mention", () => {
  expect(recoveryFailureDetail({ detail: "install ran out of memory" })).toBe(
    "install ran out of memory",
  );
  expect(recoveryFailureDetail({ detail: "  " })).toBeNull();
  expect(recoveryFailureDetail(null)).toBeNull();
  expect(recoveryFailureDetail("nope")).toBeNull();
});
