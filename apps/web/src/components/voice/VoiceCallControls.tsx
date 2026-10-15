import { RiPhoneFill, RiPhoneLine } from "@remixicon/react";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { Bot } from "../roster/types";
import { useBotEngineAvailability } from "../roster/useBotEngineAvailability";
import { useRosterStore } from "../roster/rosterStore";
import { Button } from "../ui/button";
import { AppIcon } from "../ui/app-icon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { usePrimarySettings } from "../../hooks/useSettings";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { BOT_COMPOSER_SURFACE_CLASS_NAME } from "../roster/botConversationPresentation";
import { type ActiveVoiceCall, useVoiceCall } from "./voiceCallContext";

export function BotVoiceCallButtonView({
  bot,
  active,
  disabled,
  disabledReason = null,
  globallyEnabled,
  onClick,
}: {
  readonly bot: Bot;
  readonly active: boolean;
  readonly disabled: boolean;
  /** Why a call cannot start, shown with the button. */
  readonly disabledReason?: string | null;
  readonly globallyEnabled: boolean;
  readonly onClick: () => void;
}) {
  const { t } = useI18n();

  if (!globallyEnabled || !bot.voiceEnabled) return null;

  const label = active
    ? t("Return to call with {name}", { name: bot.name })
    : t("Call {name}", { name: bot.name });

  const description = disabled && disabledReason ? `${label}. ${disabledReason}` : label;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={description}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        <AppIcon icon={RiPhoneLine} />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{description}</TooltipPopup>
    </Tooltip>
  );
}

export function BotVoiceCallButton({
  bot,
  disabled = false,
}: {
  readonly bot: Bot;
  readonly disabled?: boolean;
}) {
  const { activeCall, startingBotId, startOrReturn } = useVoiceCall();
  const globallyEnabled = usePrimarySettings((settings) => settings.voice.enabled);
  const engine = useBotEngineAvailability(bot.engine);
  const active = activeCall?.botId === bot.id;
  const blocked = engine.blocked && !active;

  return (
    <BotVoiceCallButtonView
      bot={bot}
      active={active}
      disabled={disabled || blocked || startingBotId !== null}
      disabledReason={blocked ? (engine.unavailability?.title ?? null) : null}
      globallyEnabled={globallyEnabled}
      onClick={() => startOrReturn(bot)}
    />
  );
}

export function SelectedBotVoiceCallButton() {
  const bot = useRosterStore((state) =>
    state.selectedBotId === null
      ? null
      : (state.bots.find((candidate) => candidate.id === state.selectedBotId) ?? null),
  );

  return bot ? <BotVoiceCallButton bot={bot} /> : null;
}

export function VoiceCallBar() {
  const { activeCall, hangup, reconnecting, returnToCall, startingBotId } = useVoiceCall();
  const panel = useMainPanel();

  const startingBotName = useRosterStore((state) =>
    startingBotId === null
      ? null
      : (state.bots.find((candidate) => candidate.id === startingBotId)?.name ?? "Bot"),
  );

  const [now, setNow] = useState(() => Date.now());
  const [ringingSince, setRingingSince] = useState<number | null>(null);
  const ringing = !activeCall && startingBotId !== null;

  useEffect(() => {
    setRingingSince(ringing ? Date.now() : null);
  }, [ringing, startingBotId]);

  useEffect(() => {
    if (!activeCall && !ringing) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);

    return () => window.clearInterval(timer);
  }, [activeCall, ringing]);

  const bar = activeCall ? (
    <VoiceCallBarView
      activeCall={activeCall}
      reconnecting={reconnecting}
      now={now}
      onReturn={returnToCall}
      onHangup={hangup}
    />
  ) : startingBotName ? (
    <VoiceCallStartingBarView
      botName={startingBotName}
      startedAt={ringingSince ?? now}
      now={now}
      onCancel={hangup}
    />
  ) : null;

  if (!bar) return null;

  // Otto: The bar floats in the main panel, 24px below its top edge like the composer above its
  // bottom edge, centered on the panel; without a main panel it falls back to the window.
  return panel ? (
    createPortal(
      <div className="pointer-events-none absolute inset-x-0 top-6 z-60 flex justify-center px-4">
        {bar}
      </div>,
      panel,
    )
  ) : (
    <div className="pointer-events-none fixed inset-x-0 top-6 z-60 flex justify-center px-4">
      {bar}
    </div>
  );
}

/** The main panel the bar floats in, found again whenever a route swaps it. */
function useMainPanel() {
  const [panel, setPanel] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const find = () =>
      setPanel(document.querySelector<HTMLElement>('main[data-slot="sidebar-inset"]'));

    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return panel;
}

/**
 * Otto: The call bar wears the composer's own surface and geometry: 40px inside a 1px border with
 * 12px corners, 14px text in from the left and a 28px hang-up button 6px from the inner edges with
 * 6px corners, so the radii nest. Ringing and live share one layout: an 8px dot (warning while it
 * rings or reconnects, success once answered), the bot's name, shimmering while it rings, and the
 * time, which counts the wait while ringing and restarts at 0:00 when the bot picks up.
 */
const CALL_BAR_CLASS_NAME = cn(
  "pointer-events-auto flex h-10.5 items-center gap-3 rounded-xl border ps-3.5 pe-1.5 shadow-composer-float backdrop-blur",
  BOT_COMPOSER_SURFACE_CLASS_NAME,
);

function formatCallTime(startedAt: number, now: number) {
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1_000));

  return `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
}

function CallBar({
  tone,
  ringing = false,
  name,
  status,
  time,
  label,
  onActivate,
  endLabel,
  onEnd,
}: {
  readonly tone: "waiting" | "live";
  /** The bot has not picked up yet: its name shimmers like a working bot's line. */
  readonly ringing?: boolean;
  readonly name: string;
  /** A short state word after the name, such as Reconnecting. */
  readonly status: string | null;
  readonly time: string;
  readonly label: string;
  readonly onActivate?: () => void;
  readonly endLabel: string;
  readonly onEnd: () => void;
}) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 self-center rounded-full",
          tone === "live" ? "bg-success" : "bg-warning",
        )}
      />
      <span
        className={cn(
          "text-sm font-medium",
          ringing && "text-muted-foreground shimmer motion-reduce:shimmer-none",
        )}
      >
        {name}
      </span>
      {status ? (
        <span className="text-xs text-muted-foreground shimmer motion-reduce:shimmer-none">
          {status}
        </span>
      ) : null}
      <span className="text-xs tabular-nums text-muted-foreground">{time}</span>
    </>
  );

  return (
    <div className={CALL_BAR_CLASS_NAME}>
      {onActivate ? (
        <button
          type="button"
          aria-label={label}
          className="flex items-baseline gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onActivate}
        >
          {content}
        </button>
      ) : (
        <div role="status" aria-label={label} className="flex items-baseline gap-2">
          {content}
        </div>
      )}
      <Button
        type="button"
        size="icon-sm"
        variant="destructive"
        aria-label={endLabel}
        onClick={onEnd}
      >
        <AppIcon icon={RiPhoneFill} />
      </Button>
    </div>
  );
}

export function VoiceCallStartingBarView({
  botName,
  startedAt,
  now,
  onCancel,
}: {
  readonly botName: string;
  /** When the call was placed, so the bar counts the wait until the bot picks up. */
  readonly startedAt: number;
  readonly now: number;
  readonly onCancel: () => void;
}) {
  const { t } = useI18n();

  return (
    <CallBar
      tone="waiting"
      ringing
      name={botName}
      status={null}
      time={formatCallTime(startedAt, now)}
      label={t("Calling {name}", { name: botName })}
      endLabel={t("Cancel call to {name}", { name: botName })}
      onEnd={onCancel}
    />
  );
}

export function VoiceCallBarView({
  activeCall,
  reconnecting,
  now,
  onReturn,
  onHangup,
}: {
  readonly activeCall: ActiveVoiceCall;
  readonly reconnecting: boolean;
  readonly now: number;
  readonly onReturn: () => void;
  readonly onHangup: () => void;
}) {
  const { t } = useI18n();

  return (
    <CallBar
      tone={reconnecting ? "waiting" : "live"}
      name={activeCall.botName}
      status={reconnecting ? t("Reconnecting") : null}
      time={formatCallTime(Date.parse(activeCall.startedAt), now)}
      label={t("Return to call with {name}", { name: activeCall.botName })}
      onActivate={onReturn}
      endLabel={t("Hang up")}
      onEnd={onHangup}
    />
  );
}
