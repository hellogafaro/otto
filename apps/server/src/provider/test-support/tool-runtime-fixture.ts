import { createOttoToolRuntime, type OttoToolRuntime } from "../otto-tool-runtime.ts";

/** Override the behavior a test observes while retaining the complete runtime contract. */
export function toolRuntimeFixture(overrides: Partial<OttoToolRuntime> = {}): OttoToolRuntime {
  return { ...createOttoToolRuntime(), ...overrides };
}
