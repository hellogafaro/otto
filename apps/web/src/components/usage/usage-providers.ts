import type { UsageBucketProvider } from "@otto/contracts";

import { useI18n } from "../../i18n";
import {
  ClaudeAI,
  CustomApiIcon,
  GrokIcon,
  KimiIcon,
  OpenCodeIcon,
  type Icon,
  OpenAI,
} from "../icons";

type UsageProviderPresentation = {
  readonly color: string;
  readonly mark: Icon;
};

/**
 * Exhaustive presentation for providers supported by the usage contract.
 * Declaration order is reused by every chart and table, so adding a provider
 * only requires its contract support, one entry here and its label.
 */
export const PROVIDER_PRESENTATION = {
  codex: { color: "var(--contrast-foreground)", mark: OpenAI },
  openai: { color: "#a78bfa", mark: OpenAI },
  claude: { color: "#d97757", mark: ClaudeAI },
  anthropic: { color: "#fbbf24", mark: ClaudeAI },
  grok: { color: "#94a3b8", mark: GrokIcon },
  kimi: { color: "#60a5fa", mark: KimiIcon },
  opencode: { color: "#34d399", mark: OpenCodeIcon },
  customOpenai: { color: "#f472b6", mark: CustomApiIcon },
} satisfies Record<UsageBucketProvider, UsageProviderPresentation>;

/** Stable provider reading order across charts, summaries, tables, and hover rows. */
export const PROVIDER_ORDER = [
  "codex",
  "openai",
  "claude",
  "anthropic",
  "grok",
  "kimi",
  "opencode",
  "customOpenai",
] satisfies UsageBucketProvider[];

/** Provider names: subscription brands as they are, API-key providers in the reader's language. */
export function useProviderLabels(): Record<UsageBucketProvider, string> {
  const { t } = useI18n();

  return {
    codex: "Codex",
    openai: t("OpenAI API"),
    claude: "Claude",
    anthropic: t("Anthropic API"),
    grok: "Grok",
    kimi: "Kimi For Coding",
    opencode: "OpenCode",
    customOpenai: t("Custom API"),
  };
}

/** Providers with real activity, independent of the metric currently displayed. */
export function providersWithUsage(
  totals: readonly {
    readonly provider: UsageBucketProvider;
    readonly costUsd: number;
    readonly totalTokens: number;
  }[],
): readonly UsageBucketProvider[] {
  const active = new Set(
    totals.flatMap((entry) => (entry.totalTokens > 0 || entry.costUsd > 0 ? [entry.provider] : [])),
  );

  return PROVIDER_ORDER.filter((provider) => active.has(provider));
}
