import { readFileSync } from "node:fs";
import { runToolSchema } from "../../apps/server/src/tools";
import type { PiInstallation } from "../../packages/runs/src";
import { createSubscription } from "../../packages/subscriptions/src";
import { qualifySubscription } from "../../packages/subscriptions/src/server";
import type { Context } from "../../packages/workspaces/src";

/** A synthetic confirmed account for authority/queue tests, not real login or gateway qualification. */
export async function controlledSubscription(c: Context) {
  const account = await createSubscription(c, {
    title: "Controlled account",
    provider: "codex",
    visibility: "workspace",
  });
  await qualifySubscription(c, account.id, "codex");
  return account.id;
}

/** Controlled installation only; no provider, account or isolation qualification. */
export const pi: PiInstallation = {
  version: "fixture-only",
  argv: ["fixture-pi"],
  authorizeModel: async () => ({
    accountId: "controlled-account",
    modelConfig: {
      contextWindow: 20000,
      maxTokens: 4000,
      reasoning: false,
      input: ["text"],
    },
  }),
};

/** Model and computer peers are controlled fixtures, not an authenticated gateway. */
export const piRuntime = {
  extensionSource: readFileSync(
    new URL("../../packages/runs/src/pi-extension.ts", import.meta.url),
    "utf8",
  ),
  toolSchema: runToolSchema,
  modelAccess: async () => ({
    baseUrl: "http://127.0.0.1:1/model/v1",
    token: "controlled-no-upstream-access",
  }),
};
