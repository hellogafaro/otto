import { EnvironmentId, USAGE_CONTRACT_VERSION, UsageDay } from "@otto/contracts";
import { mergeUsage } from "@otto/shared/usageMerge";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  useUsage: vi.fn(),
}));

vi.mock("../../state/usage", () => ({ useUsage: testState.useUsage }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => "",
}));

vi.mock("../ui/button", () => ({ Button: "button" }));

vi.mock("../roster/roster-store", () => ({
  useRosterStore: <T,>(select: (state: { bots: readonly [] }) => T): T => select({ bots: [] }),
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));

vi.mock("../ui/dialog", () => ({
  DialogHeader: "header",
  DialogPanel: "div",
  DialogTitle: "h1",
  DialogClose: (props: { children?: ReactNode }) => <button type="button">{props.children}</button>,
}));

vi.mock("./usage-charts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./usage-charts")>();

  return {
    ...actual,
    UsagePlanLimits: (props: {
      planLimits: { provider: string; windows: { label: string; usedPercent: number }[] }[];
    }) =>
      props.planLimits.map((limits) => (
        <div key={limits.provider}>
          {limits.provider}{" "}
          {limits.windows
            .map((window) => `${window.label} ${Math.round(100 - window.usedPercent)}% left`)
            .join(" ")}
        </div>
      )),
    UsageActivityChart: () => <div>activity-chart</div>,
  };
});

import { UsagePage } from "./usage-page";
import { saveUsagePagePreferences } from "./usage-page-preferences";

const connectedPlanLimits = [
  {
    provider: "openai-codex" as const,
    status: "ok" as const,
    plan: "Pro",
    message: null,
    windows: [
      { kind: "weekly" as const, label: "Weekly", usedPercent: 45, resetsAt: null },
      { kind: "session" as const, label: "Spark 5-hour", usedPercent: 0, resetsAt: null },
    ],
  },
  {
    provider: "anthropic" as const,
    status: "failed" as const,
    plan: null,
    message: "Run claude and sign in.",
    windows: [],
  },
];

beforeEach(() => {
  saveUsagePagePreferences({ metric: "cost", windowDays: 30 });
  testState.useUsage.mockReturnValue({
    merged: {
      ...mergeUsage([], USAGE_CONTRACT_VERSION),
      planLimits: connectedPlanLimits,
    },
    environments: [
      {
        environmentId: "env-1",
        label: "This Mac",
        isPending: false,
        error: null,
        summary: { contractVersion: USAGE_CONTRACT_VERSION },
      },
    ],
    isPending: false,
    isPartial: false,
    refresh: vi.fn(),
  });
});

describe("UsagePage", () => {
  it("uses the regular settings content frame without a nested workspace shell", () => {
    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).toContain("data-settings-page-scroll");
    expect(markup).toContain('id="usage"');
    expect(markup).not.toContain("data-workspace-header");
    expect(markup).not.toContain('data-slot="sidebar-inset"');
    expect(markup).not.toContain("<main");
  });

  it("shows remaining plan for connected providers only", () => {
    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).toContain("Weekly 55% left");
    expect(markup).toContain("Spark 5-hour 100% left");
    expect(markup).toContain("openai-codex");
    expect(markup).not.toContain("Run claude and sign in");
    expect(markup).not.toContain("anthropic");
  });

  it("stays quiet while the first scan is still in flight", () => {
    testState.useUsage.mockReturnValue({
      merged: mergeUsage([], USAGE_CONTRACT_VERSION),
      environments: [
        {
          environmentId: "env-1",
          label: "This Mac",
          isPending: true,
          error: null,
          summary: null,
        },
      ],
      isPending: true,
      isPartial: false,
      refresh: vi.fn(),
    });

    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).not.toContain("Reading plan limits");
    expect(markup).not.toContain("Weekly 55% left");
    expect(markup).not.toContain("Connect a subscription");
    expect(markup).not.toContain("Connect an environment");
    expect(markup).not.toContain("Activity");
    expect(markup).not.toContain("animate-spin");
  });

  it("keeps arrived plan limits visible while another environment is still reporting", () => {
    testState.useUsage.mockReturnValue({
      merged: {
        ...mergeUsage([], USAGE_CONTRACT_VERSION),
        planLimits: connectedPlanLimits,
      },
      environments: [
        {
          environmentId: "env-1",
          label: "This Mac",
          isPending: false,
          error: null,
          summary: { contractVersion: USAGE_CONTRACT_VERSION },
        },
        {
          environmentId: "env-2",
          label: "Office",
          isPending: true,
          error: null,
          summary: null,
        },
      ],
      isPending: false,
      isPartial: true,
      refresh: vi.fn(),
    });

    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).toContain("Weekly 55% left");
    expect(markup).not.toContain("Reading plan limits");
    expect(markup).not.toContain("Activity");
    expect(markup).not.toContain("activity-chart");
    expect(markup).not.toContain("animate-spin");
  });

  it("shows a connected Claude card when windows have not arrived yet", () => {
    testState.useUsage.mockReturnValue({
      merged: {
        ...mergeUsage([], USAGE_CONTRACT_VERSION),
        planLimits: [
          {
            provider: "anthropic" as const,
            status: "ok" as const,
            plan: null,
            message: null,
            windows: [],
          },
        ],
      },
      environments: [
        {
          environmentId: "env-1",
          label: "This Mac",
          isPending: false,
          error: null,
          summary: { contractVersion: USAGE_CONTRACT_VERSION },
        },
      ],
      isPending: false,
      isPartial: false,
      refresh: vi.fn(),
    });

    const markup = renderToStaticMarkup(<UsagePage />);
    expect(markup).toContain("anthropic");
  });

  it("lists each model once under the Model column, whatever its provider", () => {
    saveUsagePagePreferences({ metric: "tokens", windowDays: 30 });

    const provider = (kind: "codex" | "claude", totalTokens: number) => ({
      provider: kind,
      costUsd: 0,
      totalTokens,
      records: 1,
      sessions: 1,
      costShare: 0,
      tokenShare: 0,
    });

    testState.useUsage.mockReturnValue({
      merged: {
        ...mergeUsage([], USAGE_CONTRACT_VERSION),
        connectedProviders: ["openai-codex" as const, "anthropic" as const],
        providers: [provider("codex", 31_000_000), provider("claude", 1_000)],
        models: [
          {
            provider: "codex" as const,
            model: "claude-opus-5",
            costUsd: 0,
            totalTokens: 31_000_000,
            records: 1,
            costShare: 0,
          },
          {
            provider: "claude" as const,
            model: "gpt-5.6-sol",
            costUsd: 0,
            totalTokens: 1_000,
            records: 1,
            costShare: 0,
          },
        ],
      },
      environments: [
        {
          environmentId: "env-1",
          label: "This Mac",
          isPending: false,
          error: null,
          summary: { contractVersion: USAGE_CONTRACT_VERSION },
        },
      ],
      isPending: false,
      isPartial: false,
      refresh: vi.fn(),
    });

    const markup = renderToStaticMarkup(<UsagePage />);

    const at = (text: string) => markup.indexOf(text);

    expect(at(">Model<")).toBeGreaterThan(-1);
    expect(at(">Model<")).toBeLessThan(at("Claude Opus 5"));
    expect(at("Claude Opus 5")).toBeLessThan(at("GPT-5.6 Sol"));
    expect(markup).toContain("31M");
    expect(markup).toContain("Claude Opus 5");
  });

  it("lists people and bots as members of one table", () => {
    const member = (personId: string | null, displayName: string | null, costUsd: number) => ({
      personId,
      botId: personId === null ? "bot-nova" : null,
      displayName,
      costUsd,
      totalTokens: 1_000,
      records: 1,
      sessions: 2,
      costShare: costUsd / 10,
    });

    testState.useUsage.mockReturnValue({
      merged: {
        ...mergeUsage([], USAGE_CONTRACT_VERSION),
        costUsd: 10,
        connectedProviders: ["openai-codex" as const],
        members: [member("person-ana", "Ana Lopez", 7), member(null, "Nova", 3)],
      },
      environments: [
        {
          environmentId: "env-1",
          label: "This Mac",
          isPending: false,
          error: null,
          summary: { contractVersion: USAGE_CONTRACT_VERSION },
        },
      ],
      isPending: false,
      isPartial: false,
      refresh: vi.fn(),
    });

    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).toContain("By member");
    expect(markup).toContain("Ana Lopez");
    expect(markup).not.toContain("Bots on their own");
    expect(markup).toContain("$7.00");
    expect(markup).toContain("70.0%");
    expect(markup).toContain("Nova");
    expect(markup.indexOf("Ana Lopez")).toBeLessThan(markup.indexOf("Nova"));
  });

  it("does not show machine-wide transcript costs when no provider is connected", () => {
    saveUsagePagePreferences({ metric: "cost", windowDays: 30 });

    const summary = {
      contractVersion: USAGE_CONTRACT_VERSION,
      readAt: "2026-09-13T00:00:00.000Z",
      timeZone: "UTC",
      sinceDay: UsageDay.make("2026-08-15"),
      untilDay: UsageDay.make("2026-09-13"),
      buckets: [
        {
          day: UsageDay.make("2026-09-13"),
          provider: "codex" as const,
          model: "gpt-5.6-sol",
          totals: {
            uncachedInputTokens: 1_000,
            cachedInputTokens: 0,
            cacheCreationTokens: 0,
            outputTokens: 100,
            reasoningTokens: 0,
          },
          costUsd: 12.34,
          cacheSavingsUsd: 0,
          costSource: "modelPriced" as const,
          records: 1,
          unpricedRecords: 0,
          sessions: 1,
        },
      ],
      sources: [
        {
          fingerprint: {
            hostId: "test-machine",
            provider: "codex" as const,
            resolvedHomePath: "/home/test/.codex/sessions",
            volumeId: "1:1",
          },
          status: "ok" as const,
          scannedFiles: 1,
          skippedFiles: 0,
          malformedRecords: 0,
          distinctSessions: 1,
          message: null,
        },
      ],
      planLimits: [],
      connectedProviders: [],
      pricing: { status: "fresh" as const, source: "litellm", fetchedAt: null, knownModels: 1 },
      scanDurationMs: 1,
    };

    testState.useUsage.mockReturnValue({
      merged: mergeUsage(
        [{ environmentId: EnvironmentId.make("env-1"), label: "This Mac", summary }],
        USAGE_CONTRACT_VERSION,
      ),
      environments: [
        {
          environmentId: "env-1",
          label: "This Mac",
          isPending: false,
          error: null,
          summary,
        },
      ],
      isPending: false,
      isPartial: false,
      refresh: vi.fn(),
    });

    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).not.toContain("$12.34");
    expect(markup).toContain("No usage yet");
  });

  it("explains stale environment coverage before suggesting a provider connection", () => {
    saveUsagePagePreferences({ metric: "cost", windowDays: 30 });

    const staleSummary = {
      contractVersion: USAGE_CONTRACT_VERSION - 1,
      readAt: "2026-09-13T00:00:00.000Z",
      timeZone: "UTC",
      sinceDay: UsageDay.make("2026-08-15"),
      untilDay: UsageDay.make("2026-09-13"),
      buckets: [],
      sources: [],
      planLimits: [],
      connectedProviders: ["openai-codex" as const],
      pricing: { status: "fresh" as const, source: "litellm", fetchedAt: null, knownModels: 1 },
      scanDurationMs: 1,
    };

    testState.useUsage.mockReturnValue({
      merged: mergeUsage(
        [
          {
            environmentId: EnvironmentId.make("env-1"),
            label: "This Mac",
            summary: staleSummary,
          },
        ],
        USAGE_CONTRACT_VERSION,
      ),
      environments: [
        {
          environmentId: "env-1",
          label: "This Mac",
          isPending: false,
          error: null,
          summary: staleSummary,
        },
      ],
      isPending: false,
      isPartial: false,
      refresh: vi.fn(),
    });

    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).toContain("This Mac runs an older server version");
    expect(markup).not.toContain("No usage yet");
  });
});
