import type {
  SubscriptionProviderId,
  UsagePlanWindow,
  UsageProviderPlanLimits,
} from "@otto/contracts";

import type { DitherColor } from "../dither-kit/palette";
import { cn } from "../../lib/utils";
import { SettingsRow, SettingsSection } from "../settings/settings-layout";
import { ClaudeAI, GrokIcon, KimiIcon, OpenCodeIcon, type Icon, OpenAI } from "../icons";

type LiveSubscriptionProviderId = Exclude<SubscriptionProviderId, "cursor">;

export const PLAN_PROVIDER_PRESENTATION: Record<
  LiveSubscriptionProviderId,
  {
    readonly label: string;
    readonly icon: Icon;
    readonly color: DitherColor;
  }
> = {
  "openai-codex": { label: "ChatGPT", icon: OpenAI, color: "green" },
  anthropic: { label: "Claude", icon: ClaudeAI, color: "orange" },
  xai: { label: "Grok", icon: GrokIcon, color: "grey" },
  "kimi-for-coding": {
    label: "Kimi For Coding",
    icon: KimiIcon,
    color: "purple",
  },
  "opencode-go": { label: "OpenCode Go", icon: OpenCodeIcon, color: "grey" },
};

export const PLAN_PROVIDER_ORDER: readonly LiveSubscriptionProviderId[] = [
  "openai-codex",
  "anthropic",
  "xai",
  "kimi-for-coding",
  "opencode-go",
];

function formatReset(resetsAt: string | null): string {
  if (resetsAt === null) return "reset unknown";
  const deltaMs = Date.parse(resetsAt) - Date.now();

  if (Number.isNaN(deltaMs) || deltaMs <= 0) return "resets soon";
  const hours = Math.round(deltaMs / (60 * 60 * 1000));

  if (hours < 48) return `resets in ${hours}h`;

  return `resets in ${Math.round(hours / 24)}d`;
}

function remainingPercent(window: UsagePlanWindow): number {
  return Math.min(100, Math.max(0, 100 - window.usedPercent));
}

/** Slots enough to fill the widest settings column at the strip's 8px pitch; the strip clips the rest. */
const STRIP_SLOTS = 120;

/** Remaining capacity reads green, then amber under a quarter, then red under a tenth. */
function capacityTone(left: number): string {
  if (left < 10) return "bg-destructive";

  return left < 25 ? "bg-warning" : "bg-success";
}

/**
 * Otto: Capacity as the routine history strip: 6px bars with 2px corners, 2px apart, across the
 * row. The remaining share is drawn in its tone over light gray slots, clipped to that share so
 * it always ends on a whole bar.
 */
function CapacityStrip({ label, left }: { readonly label: string; readonly left: number }) {
  const slots = (className: string) =>
    Array.from({ length: STRIP_SLOTS }, (_, slot) => (
      <span key={slot} className={cn("h-6 w-1.5 shrink-0 rounded-xs", className)} />
    ));

  return (
    <div
      role="img"
      aria-label={`${label}: ${Math.round(left)}% left`}
      className="relative h-6 min-w-0 flex-1 overflow-hidden"
    >
      <div className="flex h-6 flex-wrap gap-x-0.5 overflow-hidden">
        {slots("bg-muted-foreground/15")}
      </div>
      <div
        className="absolute inset-y-0 start-0 flex h-6 w-(--left) flex-wrap gap-x-0.5 overflow-hidden"
        style={{ "--left": `${left}%` }}
      >
        {slots(capacityTone(left))}
      </div>
    </div>
  );
}

/**
 * Plan limits as one card with a row per connected account: its plan, then a line per limit
 * window with its capacity strip, what is left and when it resets.
 */
export function UsagePlanLimits({
  planLimits,
}: {
  readonly planLimits: readonly UsageProviderPlanLimits[];
}) {
  return (
    <SettingsSection title="Plan limits">
      {planLimits.map((limits) => {
        const presentation = PLAN_PROVIDER_PRESENTATION[limits.provider];
        const Mark = presentation.icon;

        return (
          <SettingsRow
            key={limits.provider}
            title={
              <span className="flex items-center gap-2">
                <Mark aria-hidden="true" className="size-3.5 shrink-0" />
                {limits.plan === null
                  ? presentation.label
                  : `${presentation.label} · ${limits.plan}`}
              </span>
            }
            description={
              limits.windows.length === 0 ? (limits.message ?? "No limit data yet.") : undefined
            }
          >
            {limits.windows.map((window) => {
              const left = remainingPercent(window);

              return (
                <div
                  key={`${window.kind}:${window.label}`}
                  className="flex items-center gap-4 py-2 text-13px"
                >
                  <span className="w-24 shrink-0 truncate text-muted-foreground">
                    {window.label}
                  </span>
                  <CapacityStrip label={window.label} left={left} />
                  <span className="w-40 shrink-0 text-end text-muted-foreground tabular-nums">
                    <span className="text-foreground">{Math.round(left)}% left</span> ·{" "}
                    {formatReset(window.resetsAt)}
                  </span>
                </div>
              );
            })}
          </SettingsRow>
        );
      })}
    </SettingsSection>
  );
}
