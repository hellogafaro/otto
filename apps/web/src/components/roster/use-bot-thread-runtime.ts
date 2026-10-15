import { Predicate } from "effect";
import { useBotConversationMessageProjection } from "./bot-conversation-message-projection";
import { useAtomValue } from "@effect/atom-react";
import {
  BotId,
  EnvironmentId,
  MessageId,
  type ModelSelection,
  type ScopedThreadRef,
} from "@otto/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePrimarySettings } from "../../hooks/use-settings";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import { newMessageId, randomUUID } from "../../lib/utils";
import { resolveAppModelSelectionState } from "../../model-selection";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  readEnvironmentSupportsFileAttachments,
  useThreadActivities,
  useThreadShell,
} from "../../state/entities";
import { environmentBotsAtom } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { primaryServerProvidersAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { derivePendingUserInputs } from "../../session-logic";
import {
  buildBotTurnStartInput,
  createBotTurnSubmissionQueue,
  findUnhandledMcpAuthorization,
} from "./bot-thread-runtime.logic";
import { BOT_INTRO_MESSAGE_PREFIX, isHiddenBotPrompt } from "./bot-intro";
import { useRosterStore } from "./roster-store";
import { ensureLocalApi } from "../../local-api";
import { resolveBotFileAttachment } from "./bot-file-attachment";
import { readThreadTurnAttachments, threadTitle } from "./thread-runtime-attachments";
import { usePlaceholderTitle } from "./use-placeholder-title";
import { useThreadPendingUserInput } from "./use-thread-pending-user-input";
import {
  type BotThreadFailure,
  commandFailure,
  latestBotThreadFailure,
  localFailure,
} from "./thread-runtime-warning.logic";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/**
 * Otto: One chat with one bot. The chat is the route's thread, created before it opened; the
 * runtime only sends into it. Null while a call or setup has no chat yet.
 */
export function useBotThreadRuntime(
  botId: string,
  threadRef: ScopedThreadRef | null,
  effectiveModelSelection: ModelSelection | null,
) {
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const serverBots = useAtomValue(environmentBotsAtom(primaryEnvironmentId ?? NO_ENVIRONMENT));
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const settings = usePrimarySettings();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const bot = useRosterStore((state) => state.bots.find((candidate) => candidate.id === botId));
  const rememberedThread = useThreadShell(threadRef);
  const linkedThreadRef = rememberedThread ? threadRef : null;

  const { messages, lastMessageRole, lastUserMessageAt } =
    useBotConversationMessageProjection(linkedThreadRef);

  const activities = useThreadActivities(linkedThreadRef);
  const openedAuthorizationActivitiesRef = useRef(new Set<string>());
  useEffect(() => {
    const authorization = findUnhandledMcpAuthorization(
      activities,
      openedAuthorizationActivitiesRef.current,
    );

    if (!authorization) return;
    openedAuthorizationActivitiesRef.current.add(authorization.activityId);
    void ensureLocalApi().shell.openExternal(authorization.url);
  }, [activities]);
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
  const resumeTurnCommand = useAtomCommand(threadEnvironment.resumeTurn, { reportFailure: false });

  const appendVoiceTranscript = useAtomCommand(threadEnvironment.appendVoiceTranscript, {
    reportFailure: false,
  });

  const titleFromFirstMessage = usePlaceholderTitle(linkedThreadRef, rememberedThread?.title);
  const botReady = serverBots.some((candidate) => candidate.id === botId);
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
    async (
      prompt: string,
      files: readonly File[],
      options: { readonly messageId?: MessageId } = {},
    ): Promise<boolean> => {
      const pendingUserInput = pendingUserInputs[0];
      const hidden = options.messageId !== undefined && isHiddenBotPrompt(options.messageId);

      if (pendingUserInput && linkedThreadRef && options.messageId !== undefined) {
        setError(localFailure("Answer the bot's question in chat, then keep talking."));

        return false;
      }

      if (pendingUserInput && linkedThreadRef && files.length === 0) {
        return answerPendingUserInputWithPrompt(pendingUserInput, prompt);
      }

      if (!botReady) {
        setError(localFailure("The bot is still connecting."));

        return Promise.resolve(false);
      }

      if (!activeProject) {
        setError(localFailure("Your workspace is still loading. Try again in a moment."));

        return Promise.resolve(false);
      }

      const unsupported = files.find((file) => resolveBotFileAttachment(file) === null);

      if (unsupported) {
        setError(localFailure(`This file type is not supported: ${unsupported.name}`));

        return Promise.resolve(false);
      }

      // The chat on screen when the message was submitted, so it lands where it was typed.
      const currentThreadRef = linkedThreadRef;

      if (!currentThreadRef) {
        setError(localFailure("The chat is still loading. Try again in a moment."));

        return false;
      }

      queuedSendCountRef.current += 1;
      setSending(true);
      setError(null);

      return sendQueueRef.current.enqueue(async () => {
        setError(null);
        const createdAt = new Date().toISOString();

        const modelSelection: ModelSelection =
          effectiveModelSelection ??
          activeProject.defaultModelSelection ??
          appDefaultModelSelection;

        const runtimeMode = bot?.runtimeMode ?? settings.localExecutionMode;
        const title = threadTitle(prompt, files);

        try {
          const attachments = await readThreadTurnAttachments(files);

          if (
            files.some((file) => resolveBotFileAttachment(file)?.type === "file") &&
            !readEnvironmentSupportsFileAttachments(activeProject.environmentId)
          ) {
            setError(localFailure("Update the connected Otto server to attach files."));

            return false;
          }

          if (rememberedThread && rememberedThread.runtimeMode !== runtimeMode) {
            const modeResult = await setRuntimeMode({
              environmentId: currentThreadRef.environmentId,
              input: { threadId: currentThreadRef.threadId, runtimeMode },
            });

            if (Predicate.isTagged(modeResult, "Failure")) {
              setError(commandFailure(modeResult));

              return false;
            }
          }

          const startResult = await startTurn({
            environmentId: currentThreadRef.environmentId,
            input: buildBotTurnStartInput({
              botId: BotId.make(botId),
              threadId: currentThreadRef.threadId,
              projectId: activeProject.id,
              title,
              message: {
                messageId: options.messageId ?? newMessageId(),
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

          if (Predicate.isTagged(startResult, "Failure")) {
            setError(commandFailure(startResult));

            return false;
          }

          if (!hidden) titleFromFirstMessage(title);

          if (hidden) return true;

          useRosterStore.getState().recordLastMessage(botId, {
            text: prompt || (files.length === 1 ? "Sent an image" : "Sent images"),
            at: createdAt,
            threadId: currentThreadRef.threadId,
          });

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
      bot,
      botId,
      effectiveModelSelection,
      botReady,
      rememberedThread?.runtimeMode,
      titleFromFirstMessage,
      settings.localExecutionMode,
      setRuntimeMode,
      linkedThreadRef,
      answerPendingUserInputWithPrompt,
      pendingUserInputs,
      startTurn,
    ],
  );

  /** Sends a call utterance as a chat turn and returns its message id for reply correlation. */
  const sendVoiceMessage = useCallback(
    async (text: string): Promise<MessageId | null> => {
      const messageId = newMessageId();

      return (await send(text, [], { messageId })) ? messageId : null;
    },
    [send],
  );

  /** Sends a prompt the bot answers but the chat never shows, such as a new bot's introduction. */
  const sendHidden = useCallback(
    (prompt: string) =>
      send(prompt, [], { messageId: MessageId.make(`${BOT_INTRO_MESSAGE_PREFIX}${randomUUID()}`) }),
    [send],
  );

  const appendTranscript = useCallback(
    async (role: "user" | "assistant", text: string) => {
      const trimmed = text.trim();

      if (trimmed.length === 0 || !linkedThreadRef) return;
      void appendVoiceTranscript({
        environmentId: linkedThreadRef.environmentId,
        input: {
          threadId: linkedThreadRef.threadId,
          messageId: newMessageId(),
          role,
          text: trimmed,
          ...(role === "assistant" ? { respondingBotId: BotId.make(botId) } : {}),
        },
      });
    },
    [appendVoiceTranscript, botId, linkedThreadRef],
  );

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
    appendTranscript,
    bootstrapped,
    botReady,
    canResume,
    project: activeProject,
    error: failure?.message ?? null,
    failure,
    turnFailure,
    linkedThreadRef,
    latestTurn: rememberedThread?.latestTurn ?? null,
    messages,
    pendingUserInputs,
    pendingUserInputAnswers,
    pendingUserInputStep,
    setPendingUserInputStep,
    respondingRequestIds,
    resume,
    resuming,
    answerPendingUserInputWithText,
    selectPendingUserInputOption,
    submitPendingUserInputAnswers,
    send,
    sendHidden,
    sendVoiceMessage,
    sending,
  };
}
