import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { scopeThreadRef } from "@otto/client-runtime/environment";
import type { ThreadId } from "@otto/contracts";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../../i18n";
import { BotAvatarView } from "../roster/bot-avatar-view";
import { BotPromptComposer } from "../roster/bot-prompt-composer";
import { useCreateChat } from "../roster/chat-navigation";
import { useBotThreadRuntime } from "../roster/use-bot-thread-runtime";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { SUBSCRIPTION_PROVIDERS } from "../settings/subscription-providers";
import { OnboardingHandoff } from "./onboarding-handoff";
import {
  desktopOnboardingDestinationReady,
  desktopOnboardingHandoffAvatarState,
  resolveDesktopOnboardingFocusLabel,
  type DesktopOnboardingDraft,
  type DesktopOnboardingHandoffPhase,
  type desktopOnboardingModelSelection,
  type OnboardingTranslate,
} from "./desktop-onboarding.logic";

const EASE = [0.23, 1, 0.32, 1] as const;

/** Caption under the assembling bot. Names what the user just did. */
function previewCaption(draft: DesktopOnboardingDraft, t: OnboardingTranslate): string {
  if (draft.step === "subscription") return t("Pick the subscription that powers your bot");

  if (draft.step === "goal") return t("Say what you want help with");

  if (draft.step === "identity") return t("Give it a name and a look");

  return t("Send the first message");
}

function ProviderChip({
  providerId,
}: {
  readonly providerId: DesktopOnboardingDraft["providerId"];
}) {
  const provider = SUBSCRIPTION_PROVIDERS.find((candidate) => candidate.id === providerId);

  if (!provider) return null;
  const ProviderIcon = provider.icon;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 py-1 pe-2.5 ps-2 text-xs text-muted-foreground">
      <ProviderIcon aria-hidden="true" className="size-3.5" />
      {provider.label}
    </span>
  );
}

function FocusChip({ label }: { readonly label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
      <span className="size-1.5 shrink-0 rounded-full bg-foreground/40" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * The first message, and the eyes on where it lands. This is the same runtime
 * hook the chat route mounts, reading the same chat, messages and turn. Once
 * it sees the submitted message on a started turn, the workspace behind
 * setup is showing that conversation too and setup may fade off it.
 */
function FirstMessageComposer({
  botId,
  botName,
  captureMode,
  modelSelection,
  submittedMessage,
  onComplete,
  onDestinationReady,
}: {
  readonly botId: string;
  readonly botName: string;
  readonly captureMode: boolean;
  readonly modelSelection: ReturnType<typeof desktopOnboardingModelSelection>;
  /** The message that was sent, once it is away. Null until then. */
  readonly submittedMessage: string | null;
  readonly onComplete: (message: string) => void;
  readonly onDestinationReady: () => void;
}) {
  const createChat = useCreateChat();
  const environmentId = usePrimaryEnvironmentId();
  const [threadId, setThreadId] = useState<ThreadId | null>(null);
  // The first message waits for its new chat to load, then goes out with its files.
  const [pending, setPending] = useState<{ prompt: string; files: readonly File[] } | null>(null);

  const threadRef = useMemo(
    () => (environmentId && threadId ? scopeThreadRef(environmentId, threadId) : null),
    [environmentId, threadId],
  );

  const runtime = useBotThreadRuntime(botId, threadRef, modelSelection);
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  const destinationReady =
    submittedMessage !== null &&
    desktopOnboardingDestinationReady({
      threadLinked: runtime.linkedThreadRef !== null,
      submittedMessage,
      messages: runtime.messages,
      turnStarted: runtime.latestTurn !== null,
    });

  useEffect(() => {
    if (destinationReady) onDestinationReady();
  }, [destinationReady, onDestinationReady]);

  const sendReady =
    pending !== null && runtime.linkedThreadRef !== null && runtime.project !== null;

  useEffect(() => {
    if (!sendReady || pending === null) return;
    setPending(null);

    void runtime.send(pending.prompt, pending.files).then((sent) => {
      if (sent) onComplete(pending.prompt);
      else setError(runtime.error ?? t("Could not send the message."));
    });
  }, [onComplete, pending, runtime, sendReady, t]);

  return (
    <div className="w-full">
      <BotPromptComposer
        botName={botName}
        draftKey={`onboarding:${botId}`}
        disabled={!captureMode && (!runtime.botReady || pending !== null)}
        onSubmit={async (prompt, files) => {
          if (captureMode) {
            onComplete(prompt);

            return true;
          }

          setError(null);
          const created = threadId ?? (await createChat({ kind: "bot", id: botId }));

          if (created === null) return false;
          setThreadId(created);
          setPending({ prompt, files });

          return true;
        }}
      />
      {error ? <p className="px-5 pt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * The right half of setup: the teammate assembling in real time. Every choice
 * in the rail lands here within a frame, so the flow reads as shaping someone
 * rather than filling in a form.
 */
export function OnboardingPreview({
  draft,
  message,
  createdBotReady,
  captureMode,
  handoff,
  modelSelection,
  onMessageSent,
  onDestinationReady,
}: {
  readonly draft: DesktopOnboardingDraft;
  readonly message: string | null;
  readonly createdBotReady: boolean;
  readonly captureMode: boolean;
  /** Null until the first message is away, then the beat the handoff is on. */
  readonly handoff: DesktopOnboardingHandoffPhase | null;
  readonly modelSelection: ReturnType<typeof desktopOnboardingModelSelection>;
  readonly onMessageSent: (message: string) => void;
  /** Fired when the workspace behind setup is showing the sent conversation. */
  readonly onDestinationReady: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const { t } = useI18n();
  const messageStep = draft.step === "message";
  const displayName = draft.name.trim() || t("Your bot");

  const focusLabel =
    draft.step === "subscription" ? null : resolveDesktopOnboardingFocusLabel(draft.goal);

  const named = draft.name.trim().length > 0;
  const headerState = handoff ? desktopOnboardingHandoffAvatarState(handoff) : "idle";

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/65 px-5">
        <BotAvatarView
          avatar={draft.avatar}
          name={displayName}
          state={headerState}
          className="size-7"
        />
        <span className="truncate text-sm font-medium">{displayName}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 lg:px-8">
          {message !== null && handoff !== null ? (
            <OnboardingHandoff
              draft={draft}
              message={message}
              phase={handoff}
              displayName={displayName}
            />
          ) : (
            <div className="relative hidden flex-col items-center text-center lg:flex">
              <motion.div
                layout
                transition={{ duration: reducedMotion ? 0 : 0.35, ease: EASE }}
                className="relative z-20 flex size-24 items-center justify-center rounded-2rem border border-border/55 bg-card/35 shadow-preview-frame"
              >
                <BotAvatarView
                  avatar={draft.avatar}
                  name={displayName}
                  state="idle"
                  className="size-16"
                />
              </motion.div>
              <motion.h2
                layout
                className="mt-5 text-xl font-medium tracking-title-lg"
                data-preview-named={named ? "true" : "false"}
              >
                {displayName}
              </motion.h2>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                <ProviderChip providerId={draft.providerId} />
                <AnimatePresence initial={false}>
                  {focusLabel ? (
                    // Keyed on presence, not text: the goal is typed a
                    // character at a time, and the chip must not re-animate
                    // on every keystroke.
                    <motion.span
                      key="focus"
                      className="inline-flex min-w-0"
                      initial={reducedMotion ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
                      transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}
                    >
                      <FocusChip label={focusLabel} />
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </div>
              <p className="mt-4 max-w-xs text-sm text-muted-foreground">
                {previewCaption(draft, t)}
              </p>
            </div>
          )}
        </div>
        <motion.div
          className={handoff ? "pointer-events-none shrink-0" : "shrink-0"}
          animate={handoff ? { opacity: 0, y: 8 } : { opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.25, ease: EASE }}
        >
          {messageStep && draft.botId && createdBotReady ? (
            <FirstMessageComposer
              botId={draft.botId}
              botName={draft.name}
              captureMode={captureMode}
              modelSelection={modelSelection}
              submittedMessage={message}
              onComplete={onMessageSent}
              onDestinationReady={onDestinationReady}
            />
          ) : (
            <BotPromptComposer
              botName={displayName}
              disabled
              readOnly
              onSubmit={async () => false}
            />
          )}
        </motion.div>
      </div>
    </div>
  );
}
