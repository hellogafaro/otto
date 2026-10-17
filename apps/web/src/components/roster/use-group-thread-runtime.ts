import { Predicate } from "effect";
import { DEFAULT_BOT_RUNTIME_MODE } from "./bot-sandbox";
import { useBotConversationMessageProjection } from "./bot-conversation-message-projection";
import { useAtomValue } from "@effect/atom-react";
import { BotId, EnvironmentId, GroupId, type ScopedThreadRef } from "@otto/contracts";
import { useCallback, useMemo, useRef, useState } from "react";

import { usePrimarySettings } from "../../hooks/use-settings";
import { newMessageId } from "../../lib/utils";
import { resolveAppModelSelectionState } from "../../model-selection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  isProviderInstancePickerSelectable,
  NO_PROVIDER_MODEL_SELECTION,
} from "../../provider-instances";
import { environmentGroupsAtom } from "../../state/bots";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  readEnvironmentSupportsFileAttachments,
  useThreadActivities,
  useThreadShell,
} from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { primaryServerProvidersAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { derivePendingUserInputs } from "../../session-logic";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import { buildGroupTurnStartInput, createBotTurnSubmissionQueue } from "./bot-thread-runtime.logic";
import { groupContainsBot } from "./roster.logic";
import { useRosterStore } from "./roster-store";
import { resolveBotFileAttachment } from "./bot-file-attachment";
import { readThreadTurnAttachments, threadTitle } from "./thread-runtime-attachments";
import { useThreadAttachmentUpload } from "./use-thread-attachment-upload";
import { usePlaceholderTitle } from "./use-placeholder-title";
import { useThreadPendingUserInput } from "./use-thread-pending-user-input";
import { groupModelSelection } from "./group-thread-model.logic";
import {
  type BotThreadFailure,
  commandFailure,
  latestBotThreadFailure,
  localFailure,
} from "./thread-runtime-warning.logic";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/** Otto: One group chat: the route's thread, created before it opened. */
export function useGroupThreadRuntime(groupId: string, threadRef: ScopedThreadRef) {
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const serverGroups = useAtomValue(environmentGroupsAtom(primaryEnvironmentId ?? NO_ENVIRONMENT));
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const settings = usePrimarySettings();
  const providers = useAtomValue(primaryServerProvidersAtom);

  const providerEntries = useMemo(
    () => applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
    [providers, settings],
  );

  const bots = useRosterStore((state) => state.bots);

  const group = useRosterStore((state) =>
    state.groups.find((candidate) => candidate.id === groupId),
  );

  const rememberedThread = useThreadShell(threadRef);
  const linkedThreadRef = rememberedThread ? threadRef : null;
  const titleFromFirstMessage = usePlaceholderTitle(linkedThreadRef, rememberedThread?.title);

  const { messages, lastMessageRole, lastUserMessageAt } =
    useBotConversationMessageProjection(linkedThreadRef);

  const activities = useThreadActivities(linkedThreadRef);
  const pendingUserInputs = useMemo(() => derivePendingUserInputs(activities), [activities]);

  // The chat's own project. A chat always has one; "No project" is the home project.
  const activeProject =
    projects.find(
      (project) =>
        project.environmentId === rememberedThread?.environmentId &&
        project.id === rememberedThread.projectId,
    ) ?? null;

  const appDefaultModelSelection = useMemo(
    () => resolveAppModelSelectionState(settings, providers),
    [providers, settings],
  );

  const setRuntimeMode = useAtomCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });

  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const uploadAttachment = useThreadAttachmentUpload();
  const resumeTurnCommand = useAtomCommand(threadEnvironment.resumeTurn, { reportFailure: false });
  const groupReady = serverGroups.some((candidate) => candidate.id === groupId);
  const sendQueueRef = useRef(createBotTurnSubmissionQueue());
  const queuedSendCountRef = useRef(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<BotThreadFailure | null>(null);

  const {
    pendingUserInputAnswers,
    pendingUserInputStep,
    setPendingUserInputStep,
    respondingRequestIds,
    answerPendingUserInputWithPrompt,
    answerPendingUserInputWithText,
    selectPendingUserInputOption,
    submitPendingUserInputAnswers,
  } = useThreadPendingUserInput({ linkedThreadRef, pendingUserInputs, onFailure: setError });

  const [resuming, setResuming] = useState(false);

  const canResume =
    linkedThreadRef !== null &&
    (rememberedThread?.session?.status === "error" ||
      rememberedThread?.session?.status === "interrupted" ||
      rememberedThread?.session?.status === "stopped") &&
    (rememberedThread?.latestTurn?.state === "error" ||
      rememberedThread?.latestTurn?.state === "interrupted" ||
      (rememberedThread?.latestTurn === null && lastMessageRole === "user"));

  const resume = useCallback(async (): Promise<boolean> => {
    if (!linkedThreadRef || !canResume || resuming) return false;
    setResuming(true);
    setError(null);

    const result = await resumeTurnCommand({
      environmentId: linkedThreadRef.environmentId,
      input: { threadId: linkedThreadRef.threadId },
    });

    setResuming(false);

    if (Predicate.isTagged(result, "Failure")) {
      setError(commandFailure(result));

      return false;
    }

    return true;
  }, [canResume, linkedThreadRef, resumeTurnCommand, resuming]);

  const send = useCallback(
    async (prompt: string, files: readonly File[], requestedBotId?: string): Promise<boolean> => {
      const pendingUserInput = pendingUserInputs[0];

      if (pendingUserInput && linkedThreadRef && files.length === 0) {
        return answerPendingUserInputWithPrompt(pendingUserInput, prompt);
      }

      if (!groupReady || !group) {
        setError(localFailure("The group is still connecting."));

        return false;
      }

      const project = activeProject;

      if (!project || !linkedThreadRef) {
        setError(localFailure("Your workspace is still loading. Try again in a moment."));

        return false;
      }

      const unsupported = files.find((file) => resolveBotFileAttachment(file) === null);

      if (unsupported) {
        setError(localFailure(`This file type is not supported: ${unsupported.name}`));

        return false;
      }

      if (
        files.some((file) => resolveBotFileAttachment(file)?.type === "file") &&
        !readEnvironmentSupportsFileAttachments(project.environmentId)
      ) {
        setError(localFailure("Update the connected Otto server to attach files."));

        return false;
      }

      // Every member hears a plain message; a mention only narrows who answers.
      const members = bots.filter(
        (bot) => bot.archivedAt === null && groupContainsBot(group, bot.id),
      );

      const mentionedBot = requestedBotId
        ? members.find((bot) => bot.id === requestedBotId)
        : undefined;

      if (requestedBotId && !mentionedBot) {
        setError(localFailure("Choose a current group member."));

        return false;
      }

      const selectionFor = (bot: (typeof members)[number]) => {
        const selection = groupModelSelection(
          bot.engine,
          project.defaultModelSelection,
          appDefaultModelSelection,
        );

        return selection &&
          selection.instanceId !== NO_PROVIDER_MODEL_SELECTION.instanceId &&
          providerEntries.some(
            (entry) =>
              entry.instanceId === selection.instanceId &&
              isProviderInstancePickerSelectable(entry),
          )
          ? selection
          : null;
      };

      const respondingBot = mentionedBot ?? members.find((bot) => selectionFor(bot) !== null);

      // Otto: a people-only group has no bot to answer; its messages only reach its people.
      const modelSelection = respondingBot
        ? selectionFor(respondingBot)
        : members.length === 0
          ? (project.defaultModelSelection ?? appDefaultModelSelection)
          : null;

      if (!modelSelection || (members.length > 0 && !respondingBot)) {
        setError(
          localFailure(
            mentionedBot
              ? "Connect this bot's provider, or mention another group member."
              : "Connect a provider for a group member.",
          ),
        );

        return false;
      }

      queuedSendCountRef.current += 1;
      setSending(true);
      setError(null);
      // The chat on screen when the message was submitted, so it lands where it was typed.
      const currentThreadRef = linkedThreadRef;

      return sendQueueRef.current.enqueue(async () => {
        setError(null);
        const createdAt = new Date().toISOString();
        const threadId = currentThreadRef.threadId;
        const title = threadTitle(prompt, files);
        const runtimeMode = DEFAULT_BOT_RUNTIME_MODE;

        try {
          const environmentId = currentThreadRef.environmentId;

          const attachments = await readThreadTurnAttachments(
            files,
            uploadAttachment(environmentId),
          );

          if (rememberedThread?.runtimeMode !== runtimeMode) {
            const modeResult = await setRuntimeMode({
              environmentId,
              input: { threadId, runtimeMode },
            });

            if (Predicate.isTagged(modeResult, "Failure")) {
              setError(commandFailure(modeResult));

              return false;
            }
          }

          const result = await startTurn({
            environmentId,
            input: buildGroupTurnStartInput({
              groupId: GroupId.make(groupId),
              ...(mentionedBot ? { respondingBotId: BotId.make(mentionedBot.id) } : {}),
              threadId,
              projectId: project.id,
              title,
              message: {
                messageId: newMessageId(),
                role: "user",
                text: prompt,
                attachments,
              },
              modelSelection,
              runtimeMode,
              interactionMode: DEFAULT_INTERACTION_MODE,
              createdAt,
              createThread: false,
            }),
          });

          if (Predicate.isTagged(result, "Failure")) {
            setError(commandFailure(result));

            return false;
          }

          titleFromFirstMessage(title);

          return true;
        } catch (cause) {
          setError(
            localFailure(cause instanceof Error ? cause.message : "Could not send the message."),
          );

          return false;
        } finally {
          queuedSendCountRef.current -= 1;

          if (queuedSendCountRef.current === 0) setSending(false);
        }
      });
    },
    [
      activeProject,
      appDefaultModelSelection,
      bots,
      group,
      groupId,
      groupReady,
      linkedThreadRef,
      answerPendingUserInputWithPrompt,
      pendingUserInputs,
      providerEntries,
      rememberedThread?.runtimeMode,
      setRuntimeMode,
      startTurn,
      titleFromFirstMessage,
      uploadAttachment,
    ],
  );

  const providerAvailable =
    group !== undefined &&
    bots.some((bot) => {
      if (bot.archivedAt !== null || !groupContainsBot(group, bot.id)) return false;

      const selection = groupModelSelection(
        bot.engine,
        activeProject?.defaultModelSelection,
        appDefaultModelSelection,
      );

      return (
        selection !== null &&
        selection.instanceId !== NO_PROVIDER_MODEL_SELECTION.instanceId &&
        providerEntries.some(
          (entry) =>
            entry.instanceId === selection.instanceId && isProviderInstancePickerSelectable(entry),
        )
      );
    });

  const session = rememberedThread?.session ?? null;

  const turnFailure = latestBotThreadFailure({
    activities,
    latestTurn: rememberedThread?.latestTurn ?? null,
    session,
    lastUserMessageAt,
  });

  const failure: BotThreadFailure | null =
    error ??
    turnFailure ??
    (session?.lastError
      ? { message: session.lastError, unavailability: session.unavailability ?? null }
      : null);

  return {
    bootstrapped,
    canResume,
    project: activeProject,
    error: failure?.message ?? null,
    failure,
    turnFailure,
    groupReady,
    providerAvailable,
    linkedThreadRef,
    latestTurn: rememberedThread?.latestTurn ?? null,
    messages,
    pendingUserInputs,
    pendingUserInputAnswers,
    pendingUserInputStep,
    setPendingUserInputStep,
    respondingRequestIds,
    respondingBotId: rememberedThread?.respondingBotId ?? null,
    resume,
    resuming,
    answerPendingUserInputWithText,
    selectPendingUserInputOption,
    submitPendingUserInputAnswers,
    send,
    sending,
  };
}
