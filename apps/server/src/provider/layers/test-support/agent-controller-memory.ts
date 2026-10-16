import { EnvironmentId, ProviderInstanceId, ThreadId } from "@otto/contracts";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";
import type { McpCapability } from "../../../mcp/mcp-invocation-context.ts";
import { BotUsageLedger, type BotUsageLedgerShape } from "../../../usage/bot-usage-ledger.ts";

export function makeMemoryOnlyCredentialOptions() {
  const requests: Array<{
    readonly threadId: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
    readonly capabilities?: ReadonlySet<McpCapability>;
  }> = [];

  const revoked: Array<ThreadId> = [];

  return {
    requests,
    revoked,
    issueMcpCredential: (request: (typeof requests)[number]) => {
      requests.push(request);

      if (!request.capabilities?.has("memory")) return Effect.as(Effect.void, undefined);

      return Effect.succeed({
        config: {
          environmentId: EnvironmentId.make("environment-test"),
          threadId: request.threadId,
          providerSessionId: `session-${String(request.threadId)}`,
          providerInstanceId: request.providerInstanceId,
          endpoint: "http://127.0.0.1:1/mcp",
          authorizationHeader: "Bearer test-memory-only",
        },
      });
    },
    revokeMcpCredential: (threadId: ThreadId) =>
      Effect.sync(() => {
        revoked.push(threadId);
      }),
  };
}

export function usageLedgerFixture() {
  const reserve = vi.fn<BotUsageLedgerShape["reserve"]>(() => Effect.succeed({} as never));
  const settle = vi.fn<BotUsageLedgerShape["settle"]>(() => Effect.succeed({} as never));

  const recordMeasurement = vi.fn<BotUsageLedgerShape["recordMeasurement"]>(() =>
    Effect.succeed({} as never),
  );

  const recordStart = vi.fn<BotUsageLedgerShape["recordStart"]>(() => Effect.succeed({} as never));
  const unused = () => Effect.die("unused");

  return {
    reserve,
    settle,
    recordMeasurement,
    recordStart,
    service: BotUsageLedger.of({
      reserve,
      settle,
      bindTurn: unused,
      settleForTurn: unused,
      finalizeForTurn: unused,
      recordMeasurement,
      recordStart,
      summarize: unused,
      pricingTotals: unused,
    }),
  };
}
