import type { Harnesses } from "../../packages/runs/src";

/** Controlled installation pins only; these commands never claim a native account or isolated provider. */
export const harnesses: Harnesses = {
  fixture: { version: "1", argv: ["fixture-acp"] },
  "codex-acp": { version: "fixture-only", argv: ["fixture-acp"] },
};
