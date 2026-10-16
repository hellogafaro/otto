import { renderToStaticMarkup } from "react-dom/server";
import type { EnvironmentId } from "@otto/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  SUBSCRIPTION_PROVIDERS,
  type SubscriptionProviderDefinition,
} from "../settings/subscription-providers";

const testState = vi.hoisted(() => ({
  accounts: {},
  creating: false,
}));

vi.mock("../settings/use-subscription-accounts", () => ({
  useSubscriptionAccounts: () => testState.accounts,
}));

vi.mock("../roster/use-create-bot", () => ({
  useCreateBot: () => ({ creating: testState.creating, canCreate: true, create: vi.fn() }),
}));

import { Onboarding } from "./onboarding";

const environmentId = "env-1" as EnvironmentId;

/** The parts of `useSubscriptionAccounts` that pick the screen. */
interface AccountsFixture {
  readonly statusQuery: {
    readonly data:
      | { readonly providers: ReadonlyArray<{ provider: string; connected: boolean }> }
      | undefined;
    readonly error: null;
  };
  readonly activeLogin: {
    readonly providerLabel: string;
    readonly error: null;
    readonly flow: Readonly<
      Record<"provider" | "loginId" | "url" | "userCode" | "completion", string>
    >;
  } | null;
  readonly keyProvider: SubscriptionProviderDefinition | null;
}

function accounts(overrides: Partial<AccountsFixture> = {}) {
  return {
    statusQuery: { data: { providers: [] }, error: null },
    activeLogin: null,
    keyProvider: null,
    busyProvider: null,
    pastedCode: "",
    baseUrl: "",
    completing: false,
    error: null,
    ...overrides,
  };
}

function render() {
  return renderToStaticMarkup(<Onboarding environmentId={environmentId} onDone={() => {}} />);
}

beforeEach(() => {
  testState.accounts = accounts();
  testState.creating = false;
});

describe("Onboarding", () => {
  it("asks for a provider first, listing every one with a way to skip", () => {
    const markup = render();

    expect(markup).toContain("Step 1 of 2");

    for (const provider of SUBSCRIPTION_PROVIDERS) expect(markup).toContain(provider.label);
    expect(markup).toContain(">Skip setup</button>");
    expect(markup).not.toContain("Create your first bot");
  });

  it("shows skeleton rows while connections load", () => {
    testState.accounts = accounts({ statusQuery: { data: undefined, error: null } });
    const markup = render();

    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("ChatGPT");
  });

  it("moves on to the first bot once a provider is connected", () => {
    testState.accounts = accounts({
      statusQuery: {
        data: { providers: [{ provider: "anthropic", connected: true }] },
        error: null,
      },
    });

    const markup = render();

    expect(markup).toContain("Step 2 of 2");
    expect(markup).toContain("Create your first bot");
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Create bot<\/button>/);
    expect(markup).toContain(">Skip setup</button>");
  });

  it("takes an API key in place of the provider list", () => {
    testState.accounts = accounts({ keyProvider: SUBSCRIPTION_PROVIDERS[0] ?? null });
    const markup = render();

    expect(markup).toContain('type="password"');
    expect(markup).toContain(">Save key</button>");
    expect(markup).not.toContain("Kimi For Coding");
  });

  it("shows the sign-in code and a link to the provider while it waits", () => {
    testState.accounts = accounts({
      activeLogin: {
        providerLabel: "ChatGPT",
        error: null,
        flow: {
          provider: "openai-codex",
          loginId: "login-1",
          url: "https://auth.example.com/device",
          userCode: "ABCD-1234",
          completion: "poll",
        },
      },
    });

    const markup = render();

    expect(markup).toContain("ABCD-1234");
    expect(markup).toContain('href="https://auth.example.com/device"');
    expect(markup).toContain(">Use an API key</button>");
  });
});
