import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@otto/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState, type ComponentType } from "react";

import { isElectron } from "../../env";
import { environmentBotsAtom, environmentRosterLoadedAtom } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentShell } from "../../state/shell";
import { toast } from "sonner";
import { useRosterStore } from "../roster/roster-store";
import {
  clearDesktopOnboardingHandoff,
  DEFAULT_DESKTOP_ONBOARDING_DRAFT,
  DESKTOP_ONBOARDING_COMPLETED_STORAGE_KEY,
  type DesktopOnboardingDraft,
  readDesktopOnboardingDraft,
  readDesktopOnboardingHandoffForEnvironment,
  writeDesktopOnboardingDraft,
} from "./desktop-onboarding-draft";
import {
  recoverMissingDesktopOnboardingBot,
  shouldShowDesktopOnboarding,
} from "./desktop-onboarding.logic";
import {
  type DesktopOnboardingSurfaceProps,
  OnboardingSurface,
} from "./desktop-onboarding-surface";

export { SubscriptionStep } from "./onboarding-subscription-step";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

function readDraft(): DesktopOnboardingDraft | null {
  return readDesktopOnboardingDraft(window.localStorage);
}

function writeDraft(draft: DesktopOnboardingDraft): void {
  writeDesktopOnboardingDraft(window.localStorage, draft);
}

function readCaptureMode(): boolean {
  return (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("otto-onboarding-capture") === "1"
  );
}

export function DesktopOnboarding({
  Surface = OnboardingSurface,
}: {
  readonly Surface?: ComponentType<DesktopOnboardingSurfaceProps>;
} = {}) {
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const atomKey = environmentId ?? NO_ENVIRONMENT;
  const shellLive = useAtomValue(environmentShell.stateValueAtom(atomKey)).status === "live";
  const rosterLoaded = useAtomValue(environmentRosterLoadedAtom(atomKey)) && shellLive;
  const serverBots = useAtomValue(environmentBotsAtom(atomKey));
  const attemptedHandoffRef = useRef<string | null>(null);
  const [draft] = useState(readDraft);

  const [completed] = useState(
    () => window.localStorage.getItem(DESKTOP_ONBOARDING_COMPLETED_STORAGE_KEY) === "1",
  );

  const [finished, setFinished] = useState(false);
  const initialDraftRef = useRef<DesktopOnboardingDraft | null>(draft);
  const [captureMode] = useState(readCaptureMode);

  if (rosterLoaded && initialDraftRef.current) {
    const currentDraft = initialDraftRef.current;

    const recoveredDraft = recoverMissingDesktopOnboardingBot(
      currentDraft,
      serverBots.map((bot) => bot.id),
    );

    if (recoveredDraft !== currentDraft) {
      initialDraftRef.current = recoveredDraft;
      writeDraft(recoveredDraft);
    }
  }

  const shouldStart =
    !finished &&
    environmentId !== null &&
    (captureMode ||
      shouldShowDesktopOnboarding({
        desktop: isElectron,
        rosterLoaded,
        serverBotCount: serverBots.length,
        draft,
        completed,
        started: initialDraftRef.current !== null,
      }));

  if (shouldStart && initialDraftRef.current === null) {
    initialDraftRef.current = DEFAULT_DESKTOP_ONBOARDING_DRAFT;
    writeDraft(DEFAULT_DESKTOP_ONBOARDING_DRAFT);
  }

  const show = shouldStart && initialDraftRef.current !== null;

  // A reload between sending the first message and opening its chat lands
  // here with setup already complete. Finish the trip to that chat once.
  useEffect(() => {
    if (!environmentId || !rosterLoaded) return;

    const handoff = readDesktopOnboardingHandoffForEnvironment(
      window.localStorage,
      environmentId,
      serverBots.map((bot) => bot.id),
    );

    if (
      !handoff ||
      handoff.environmentId !== environmentId ||
      attemptedHandoffRef.current === handoff.botId
    )
      return;
    const handoffBot = serverBots.find((bot) => bot.id === handoff.botId);

    if (handoffBot?.archivedAt) {
      clearDesktopOnboardingHandoff(window.localStorage);
      toast.error("Your new bot was archived before its chat opened");

      return;
    }

    if (!handoffBot) {
      return;
    }

    const botId = handoff.botId;
    attemptedHandoffRef.current = botId;
    useRosterStore.getState().selectBot(botId);
    void navigate({ to: "/bots/$botId", params: { botId }, replace: true }).then(
      () => clearDesktopOnboardingHandoff(window.localStorage),
      () => toast.error("Your new chat couldn't be reopened"),
    );
  }, [environmentId, navigate, rosterLoaded, serverBots]);

  useEffect(() => {
    if (!rosterLoaded || serverBots.length === 0 || initialDraftRef.current !== null) return;
    window.localStorage.setItem(DESKTOP_ONBOARDING_COMPLETED_STORAGE_KEY, "1");
  }, [rosterLoaded, serverBots.length]);

  return (
    <AnimatePresence>
      {show && initialDraftRef.current && environmentId ? (
        <Surface
          key="desktop-onboarding"
          initialDraft={initialDraftRef.current}
          environmentId={environmentId}
          captureMode={captureMode}
          onFinished={() => setFinished(true)}
        />
      ) : null}
    </AnimatePresence>
  );
}
