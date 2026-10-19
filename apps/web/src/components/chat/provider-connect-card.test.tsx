import { renderToStaticMarkup } from "react-dom/server";
import type { EnvironmentId, SubscriptionProviderId } from "@otto/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CONVERSATION_MEASURE_CLASS_NAME } from "../roster/bot-conversation-presentation";

const testState = vi.hoisted(() => ({
  accounts: {
    statusByProvider: new Map<string, { connected: boolean }>(),
    activeLogin: null,
    keyProvider: null,
    busyProvider: null,
    error: null,
  },
}));

vi.mock("../settings/use-subscription-accounts", () => ({
  useSubscriptionAccounts: () => testState.accounts,
}));

import { ProviderConnectCard } from "./provider-connect-card";

describe("ProviderConnectCard", () => {
  beforeEach(() => {
    testState.accounts = {
      statusByProvider: new Map([["xai", { connected: false }]]),
      activeLogin: null,
      keyProvider: null,
      busyProvider: null,
      error: null,
    };
  });

  it("sits on the same column as the composer", () => {
    const markup = renderToStaticMarkup(
      <ProviderConnectCard
        environmentId={"env-1" as EnvironmentId}
        provider={"xai" as SubscriptionProviderId}
        botName="Radar"
        className="mt-2"
      />,
    );

    expect(markup).toContain("Connect Grok to chat with Radar");
    expect(markup).toContain("px-gutter-48rem");
    expect(markup).toContain("sm:px-gutter-48rem-wide");
    expect(markup).toContain(CONVERSATION_MEASURE_CLASS_NAME);
    expect(markup).not.toContain("max-w-3xl");
  });
});
