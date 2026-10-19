import {
  type AuthSessionId,
  type ChatAttachment,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  GENERAL_PROJECT_ID,
  type ModelSelection,
  isGroupBotMember,
  ProviderDriverKind,
  ThreadId,
  type ProviderSession,
  SANDBOX_PROVIDER_CREDENTIALS,
  type BotId,
} from "@otto/contracts";
import { HostProcessEnvironment } from "@otto/shared/hostProcess";
import { groupRosterContext } from "../../group-responder.ts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import { resolveThreadWorkspaceCwd } from "../../../checkpointing/utils.ts";
import { chatMemory } from "../../../memory/memories.ts";
import { taskChatId } from "../../../tasks/task-work-reactor.ts";
import { ProviderAdapterRequestError } from "../../../provider/errors.ts";
import { resolveTurnModelSelection } from "../../../provider/turn-provider-selection.ts";
import {
  botRuntimeResourceScope,
  botSandboxEnvironment,
  botWorkspaceCredentialFingerprint,
  defaultBotSandbox,
  botWorkspaceResourceKey,
} from "../../../provider/bot-workspace-pool.ts";
import {
  providerErrorLabel,
  isProviderDriverKind,
  resolveControllerBotId,
  mapProviderSessionStatusToOrchestrationStatus,
  toNonEmptyProviderInput,
} from "./fields.ts";
import type { createContext } from "./context.ts";
import type { createDependencies } from "./dependencies.ts";
import type { createFailures } from "./failures.ts";
import type { createWorkspace } from "./workspace.ts";
import type { createMentions } from "./mentions.ts";

/** How many people and projects the bot's workspace context names. */
const WORKSPACE_CONTEXT_LIMIT = 50;

export function createSession({
  resolveThreadShell,
  threadsAwaitingRestrictiveSessionCleanup,
  agentController,
  resolveControllerEngine,
  setThreadSession,
  rejectStartedThreadModelChangeIfRequired,
  resolveProject,
  projectionSnapshotQuery,
  resolveControllerMcpServers,
  serverSettingsService,
  providerRegistry,
  projectionBotRepository,
  threadModelSelections,
  threadMcpServers,
  threadBotWorkspaceKeys,
  threadRespondingBotIds,
  providerSessionDirectory,
  expandComposerMentions,
  accounts,
  projects,
}: Pick<
  ReturnType<typeof createContext> &
    Effect.Success<ReturnType<typeof createDependencies>> &
    ReturnType<typeof createFailures> &
    ReturnType<typeof createWorkspace> &
    ReturnType<typeof createMentions>,
  | "resolveThreadShell"
  | "threadsAwaitingRestrictiveSessionCleanup"
  | "agentController"
  | "resolveControllerEngine"
  | "setThreadSession"
  | "rejectStartedThreadModelChangeIfRequired"
  | "resolveProject"
  | "projectionSnapshotQuery"
  | "resolveControllerMcpServers"
  | "serverSettingsService"
  | "providerRegistry"
  | "projectionBotRepository"
  | "threadModelSelections"
  | "threadMcpServers"
  | "threadBotWorkspaceKeys"
  | "threadRespondingBotIds"
  | "providerSessionDirectory"
  | "expandComposerMentions"
  | "accounts"
  | "projects"
>) {
  const reconcileRestrictiveSessionCleanup = Effect.fn("reconcileRestrictiveSessionCleanup")(
    function* (threadId: ThreadId) {
      const thread = yield* resolveThreadShell(threadId);

      const persistedCleanupRequired =
        thread?.runtimeMode === "approval-required" &&
        thread.session?.runtimeMode === "full-access" &&
        thread.session.status === "error";

      if (!threadsAwaitingRestrictiveSessionCleanup.has(threadId) && !persistedCleanupRequired) {
        return false;
      }

      threadsAwaitingRestrictiveSessionCleanup.add(threadId);

      const activeSession = (yield* agentController.listSessions()).find(
        (session) => session.threadId === threadId,
      );

      if (activeSession === undefined) {
        threadsAwaitingRestrictiveSessionCleanup.delete(threadId);

        return true;
      }

      yield* agentController.interruptTurn({ threadId }).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.interrupt;
          }

          return Effect.logWarning(
            "provider command reactor failed to interrupt quarantined session",
            {
              threadId,
              cause: Cause.pretty(cause),
            },
          );
        }),
      );

      const sessionAfterInterrupt = (yield* agentController.listSessions()).find(
        (session) => session.threadId === threadId,
      );

      if (sessionAfterInterrupt === undefined) {
        threadsAwaitingRestrictiveSessionCleanup.delete(threadId);

        return true;
      }

      yield* agentController.stopSession({ threadId });

      const remainingSession = (yield* agentController.listSessions()).find(
        (session) => session.threadId === threadId,
      );

      if (remainingSession !== undefined) {
        return yield* new ProviderAdapterRequestError({
          provider: providerErrorLabel(remainingSession.provider),
          method: "thread.session.stop",
          detail: `Provider session '${threadId}' is still active after a restrictive runtime mode update failed.`,
        });
      }

      threadsAwaitingRestrictiveSessionCleanup.delete(threadId);

      return true;
    },
  );

  const ensureSessionForThread = Effect.fn("ensureSessionForThread")(function* (
    threadId: ThreadId,
    createdAt: string,
    options?: {
      readonly modelSelection?: ModelSelection;
      readonly pendingTurnStart?: boolean;
    },
  ) {
    const thread = yield* resolveThreadShell(threadId);

    if (!thread) {
      return yield* Effect.die(new Error(`Thread '${threadId}' was not found in read model.`));
    }

    const desiredRuntimeMode = thread.runtimeMode;
    const requestedModelSelection = options?.modelSelection;

    const resolveActiveSession = (threadId: ThreadId) =>
      agentController
        .listSessions()
        .pipe(Effect.map((sessions) => sessions.find((session) => session.threadId === threadId)));

    const activeSession = yield* resolveActiveSession(threadId);

    const activeThreadSession =
      thread.session !== null && thread.session.status !== "stopped" && activeSession
        ? thread.session
        : null;

    if (
      activeThreadSession !== null &&
      activeSession !== undefined &&
      (activeThreadSession.providerInstanceId === undefined ||
        activeSession.providerInstanceId === undefined)
    ) {
      return yield* new ProviderAdapterRequestError({
        provider: providerErrorLabel(activeThreadSession.providerName ?? undefined),
        method: "thread.turn.start",
        detail: `Thread '${threadId}' has an active provider session without a provider instance id.`,
      });
    }

    const currentInstanceId =
      activeThreadSession !== null &&
      activeSession !== undefined &&
      activeSession.providerInstanceId !== undefined
        ? activeSession.providerInstanceId
        : thread.modelSelection.instanceId;

    // A bot with no saved engine follows the current default model, the same
    // one the chat shows. The selection stored on the thread is only the model
    // from when the project was created, and a new chat copies that, so a
    // request that only repeats it is not a choice of provider.
    const serverSettings = yield* serverSettingsService.getSettings;
    const botThread = thread.botId != null || thread.groupId != null;

    const repeatsStoredSelection =
      requestedModelSelection !== undefined &&
      requestedModelSelection.instanceId === thread.modelSelection.instanceId &&
      requestedModelSelection.model === thread.modelSelection.model;

    const explicitSelection =
      botThread && repeatsStoredSelection ? undefined : requestedModelSelection;

    // The request may only repeat the chat's stored model. If that instance
    // was turned off or removed, run the live provider instead of inspecting it.
    const providers = yield* providerRegistry.getProviders;

    const fallback = resolveTurnModelSelection({
      requested: requestedModelSelection,
      stored: thread.modelSelection,
      liveDefault: serverSettings.textGenerationModelSelection,
      isBotThread: botThread,
      providers,
    });

    const desiredEngine = yield* resolveControllerEngine(thread, fallback);

    const desiredModelSelection = desiredEngine.modelSelection;
    const desiredInstanceId = desiredModelSelection.instanceId;

    const effectiveRequestedModelSelection = desiredEngine.configured
      ? desiredModelSelection
      : explicitSelection;

    const desiredInfo = desiredEngine.routing;
    const desiredDriverKind = desiredInfo.driverKind;

    // Only the instance this turn will run is inspected. A disabled instance
    // left on the chat must not block whichever provider was chosen.

    if (!isProviderDriverKind(desiredDriverKind)) {
      return yield* new ProviderAdapterRequestError({
        provider: providerErrorLabel(String(desiredDriverKind)),
        method: "thread.turn.start",
        detail: `Requested provider instance '${desiredInstanceId}' uses unknown provider driver '${desiredDriverKind}'. The driver is not installed in this build.`,
      });
    }

    const preferredProvider: ProviderDriverKind = desiredDriverKind;

    if (options?.pendingTurnStart === true && thread.session?.status !== "running") {
      yield* setThreadSession({
        threadId,
        session: {
          threadId,
          status: "starting",
          providerName: activeSession?.provider ?? preferredProvider,
          providerInstanceId: activeSession?.providerInstanceId ?? desiredInstanceId,
          runtimeMode: desiredRuntimeMode,
          mcpServerIds: activeSession?.mcpServerIds ?? [],
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      });
    }

    if (thread.session !== null) {
      yield* rejectStartedThreadModelChangeIfRequired({
        threadId,
        currentModelSelection:
          activeSession?.model !== undefined
            ? {
                ...thread.modelSelection,
                instanceId: currentInstanceId,
                model: activeSession.model,
              }
            : thread.modelSelection,
        requestedModelSelection: effectiveRequestedModelSelection,
      });
    }

    // Another instance of the same driver keeps its resume cursor. A different
    // driver does not. The session already knows its driver, so the stored
    // instance is not inspected again.
    const providerChanged =
      activeSession !== undefined && activeSession.provider !== desiredDriverKind;

    const project = yield* resolveProject(thread.projectId);

    const mcpServers = yield* resolveControllerMcpServers(thread);
    const respondingBotId = resolveControllerBotId(thread);

    const respondingBot =
      respondingBotId === null
        ? undefined
        : yield* projectionBotRepository
            .getById({ botId: respondingBotId })
            .pipe(Effect.map(Option.getOrUndefined));

    const respondingGroup =
      thread.groupId == null
        ? undefined
        : projectionSnapshotQuery.getGroupById
          ? Option.getOrUndefined(yield* projectionSnapshotQuery.getGroupById(thread.groupId))
          : (yield* projectionSnapshotQuery.getCommandReadModel()).groups.find(
              (group) => group.id === thread.groupId,
            );

    const groupBots = new Map<BotId, { readonly name: string; readonly role: string | null }>();

    for (const member of respondingGroup?.members.filter(isGroupBotMember) ?? []) {
      const bot = yield* projectionBotRepository.getById({ botId: member.botId });

      if (Option.isSome(bot)) {
        groupBots.set(member.botId, {
          name: bot.value.name,
          role: bot.value.description || bot.value.label,
        });
      }
    }

    const groupContext = respondingGroup
      ? groupRosterContext({
          groupName: respondingGroup.name,
          members: respondingGroup.members,
          respondingBotId,
          bots: groupBots,
        })
      : undefined;

    // Otto: the bot knows which project its chat is filed in; the home project at the
    // General project is "No project" and needs no introduction.
    const projectContext =
      project && project.id !== GENERAL_PROJECT_ID
        ? [`This chat is in the project "${project.title}".`, project.description?.trim()]
            .filter(Boolean)
            .join(" ")
        : undefined;

    const organization = Option.isSome(accounts) ? accounts.value.runtime.getOrganization() : null;

    const people = Option.isSome(accounts)
      ? yield* accounts.value.listPeople().pipe(Effect.orElseSucceed(() => []))
      : [];

    const projectTitles = Option.isSome(projects)
      ? (yield* projects.value.listAll().pipe(Effect.orElseSucceed(() => []))).flatMap((entry) =>
          entry.deletedAt === null && entry.projectId !== GENERAL_PROJECT_ID
            ? [`${entry.title} (projectId ${entry.projectId})`]
            : [],
        )
      : [];

    // Otto: who and what the bot can refer to without listing tasks first; capped for large teams.
    const workspaceContext = [
      people.length > 0
        ? `People: ${people
            .slice(0, WORKSPACE_CONTEXT_LIMIT)
            .map((person) => `${person.displayName} (person:${person.userId})`)
            .join(", ")}`
        : "",
      projectTitles.length > 0
        ? `Projects: ${projectTitles.slice(0, WORKSPACE_CONTEXT_LIMIT).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const serverBoatKey = (yield* HostProcessEnvironment).BOAT_API_KEY;

    const effectiveSandbox =
      respondingBot?.sandbox ?? defaultBotSandbox(serverSettings.sandbox, serverBoatKey);
    const sandboxSize = respondingBot?.sandboxSize ?? serverSettings.sandbox.defaultSize;

    const sandboxEnvironment =
      effectiveSandbox === "local"
        ? undefined
        : botSandboxEnvironment(serverSettings.sandbox, effectiveSandbox, serverBoatKey);

    if (effectiveSandbox !== "local") {
      const missingCredential = SANDBOX_PROVIDER_CREDENTIALS[effectiveSandbox].find(
        (credential) => !(sandboxEnvironment?.[credential.name] ?? "").trim(),
      );

      if (missingCredential) {
        return yield* new ProviderAdapterRequestError({
          provider: providerErrorLabel(preferredProvider),
          method: "thread.turn.start",
          detail: "This bot's computer isn't connected. Connect it in Settings > Computer.",
        });
      }
    }

    const effectiveCwd = resolveThreadWorkspaceCwd({
      thread,
      projects: project ? [project] : [],
    });

    const botWorkspaceKey = botWorkspaceResourceKey({
      resourceScope: botRuntimeResourceScope({
        ...(respondingBotId ? { botId: respondingBotId } : {}),
        threadId,
      }),
      sandbox: effectiveSandbox,
      ...(sandboxEnvironment
        ? {
            credentialFingerprint: botWorkspaceCredentialFingerprint(sandboxEnvironment),
          }
        : {}),
    });

    const startProviderSession = (input?: {
      readonly resumeCursor?: unknown;
      readonly provider?: ProviderDriverKind;
    }) =>
      agentController.startSession(threadId, {
        threadId,
        ...(preferredProvider ? { provider: preferredProvider } : {}),
        providerInstanceId: desiredInstanceId,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
        ...(thread.title ? { title: thread.title } : {}),
        modelSelection: desiredModelSelection,
        mcpServers,
        ...(respondingBotId ? { botId: respondingBotId } : {}),
        ...(respondingBot ? { botName: respondingBot.name } : {}),
        ...(groupContext ? { groupContext } : {}),
        ...(projectContext ? { projectContext } : {}),
        ...(organization ? { workspaceName: organization.name } : {}),
        ...(workspaceContext ? { workspaceContext } : {}),
        ...(respondingBot?.instructions?.trim()
          ? { botInstructions: respondingBot.instructions.trim() }
          : {}),
        botSandbox: effectiveSandbox,
        botSandboxSize: sandboxSize,
        ...(sandboxEnvironment ? { botSandboxEnvironment: sandboxEnvironment } : {}),
        ...(input?.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
        runtimeMode: desiredRuntimeMode,
      });

    const bindSessionToThread = (session: ProviderSession) =>
      Effect.gen(function* () {
        if (session.providerInstanceId === undefined) {
          return yield* new ProviderAdapterRequestError({
            provider: providerErrorLabel(session.provider),
            method: "thread.turn.start",
            detail: `Provider session '${session.threadId}' started without a provider instance id.`,
          });
        }

        yield* setThreadSession({
          threadId,
          session: {
            threadId,
            status:
              options?.pendingTurnStart === true && session.status === "ready"
                ? "starting"
                : mapProviderSessionStatusToOrchestrationStatus(session.status),
            providerName: session.provider,
            providerInstanceId: session.providerInstanceId,
            runtimeMode: desiredRuntimeMode,
            mcpServerIds: session.mcpServerIds ?? [],
            // Provider turn ids are not orchestration turn ids.
            activeTurnId: null,
            lastError: session.lastError ?? null,
            updatedAt: session.updatedAt,
          },
          createdAt,
        });
      });

    const existingSessionThreadId =
      thread.session && thread.session.status !== "stopped" && activeSession ? thread.id : null;

    if (existingSessionThreadId) {
      const runtimeModeChanged = thread.runtimeMode !== thread.session?.runtimeMode;
      const cwdChanged = effectiveCwd !== activeSession?.cwd;
      const sessionModelSwitch = desiredEngine.capabilities.sessionModelSwitch;

      const modelChanged =
        effectiveRequestedModelSelection !== undefined &&
        effectiveRequestedModelSelection.model !== activeSession?.model;

      const instanceChanged =
        effectiveRequestedModelSelection !== undefined &&
        activeSession?.providerInstanceId !== effectiveRequestedModelSelection.instanceId;

      const shouldRestartForModelChange = modelChanged && sessionModelSwitch === "unsupported";
      const previousModelSelection = threadModelSelections.get(threadId);

      const shouldRestartForModelSelectionChange =
        preferredProvider === "claudeAgent" &&
        effectiveRequestedModelSelection !== undefined &&
        !Equal.equals(previousModelSelection, effectiveRequestedModelSelection);

      const previousMcpServers = threadMcpServers.get(threadId);

      const mcpServersChanged = previousMcpServers
        ? !Equal.equals(previousMcpServers, mcpServers)
        : !Equal.equals(
            activeSession?.mcpServerIds ?? [],
            mcpServers.map((server) => server.id),
          );

      const previousBotWorkspaceKey = threadBotWorkspaceKeys.get(threadId);

      const botWorkspaceChanged =
        previousBotWorkspaceKey !== undefined && previousBotWorkspaceKey !== botWorkspaceKey;

      // Group bots take turns on one session, which must carry the answering bot's
      // name and roster. An unknown previous bot (after a restart) counts as a change.
      const respondingBotChanged =
        thread.groupId != null && threadRespondingBotIds.get(threadId) !== respondingBotId;

      const activeTurnId = activeSession?.activeTurnId;

      if ((botWorkspaceChanged || respondingBotChanged) && activeTurnId !== undefined) {
        yield* Effect.logInfo("provider command reactor deferred bot workspace migration", {
          threadId,
          activeTurnId,
          previousBotWorkspaceKey,
          botWorkspaceKey,
          respondingBotChanged,
        });

        return { threadId: existingSessionThreadId, engine: desiredEngine };
      }

      if (
        !runtimeModeChanged &&
        !cwdChanged &&
        !instanceChanged &&
        !shouldRestartForModelChange &&
        !shouldRestartForModelSelectionChange &&
        !mcpServersChanged &&
        !botWorkspaceChanged &&
        !respondingBotChanged
      ) {
        threadBotWorkspaceKeys.set(threadId, botWorkspaceKey);
        threadRespondingBotIds.set(threadId, respondingBotId);
        threadMcpServers.set(threadId, mcpServers);

        return { threadId: existingSessionThreadId, engine: desiredEngine };
      }

      const resumeCursor =
        shouldRestartForModelChange || providerChanged || botWorkspaceChanged
          ? undefined
          : (activeSession?.resumeCursor ?? undefined);

      yield* Effect.logInfo("provider command reactor restarting provider session", {
        threadId,
        existingSessionThreadId,
        currentProvider: activeSession?.provider,
        currentInstanceId,
        desiredInstanceId,
        desiredProvider: desiredModelSelection.instanceId,
        currentRuntimeMode: thread.session?.runtimeMode,
        desiredRuntimeMode: thread.runtimeMode,
        runtimeModeChanged,
        previousCwd: activeSession?.cwd,
        desiredCwd: effectiveCwd,
        cwdChanged,
        modelChanged,
        instanceChanged,
        providerChanged,
        shouldRestartForModelChange,
        shouldRestartForModelSelectionChange,
        mcpServersChanged,
        botWorkspaceChanged,
        respondingBotChanged,
        hasResumeCursor: resumeCursor !== undefined,
      });

      if (mcpServersChanged || providerChanged) {
        yield* agentController.stopSession({ threadId });
      }

      const restartedSession = yield* startProviderSession(
        resumeCursor !== undefined ? { resumeCursor } : undefined,
      );

      yield* Effect.logInfo("provider command reactor restarted provider session", {
        threadId,
        previousSessionId: existingSessionThreadId,
        restartedSessionThreadId: restartedSession.threadId,
        provider: restartedSession.provider,
        runtimeMode: restartedSession.runtimeMode,
        cwd: restartedSession.cwd,
      });
      yield* bindSessionToThread(restartedSession);
      threadBotWorkspaceKeys.set(threadId, botWorkspaceKey);
      threadRespondingBotIds.set(threadId, respondingBotId);
      threadMcpServers.set(threadId, mcpServers);

      return { threadId: restartedSession.threadId, engine: desiredEngine };
    }

    const persistedBinding = Option.isSome(providerSessionDirectory)
      ? yield* providerSessionDirectory.value.getBinding(threadId).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("provider command reactor could not read resumable session binding", {
              threadId,
              cause: Cause.pretty(cause),
            }).pipe(Effect.as(Option.none())),
          ),
        )
      : Option.none();

    const resumableBinding = Option.getOrUndefined(persistedBinding);

    const resumeCursor =
      resumableBinding?.provider === preferredProvider &&
      resumableBinding.providerInstanceId === desiredInstanceId &&
      resumableBinding.resumeCursor != null
        ? resumableBinding.resumeCursor
        : undefined;

    const startedSession = yield* startProviderSession(
      resumeCursor === undefined ? undefined : { resumeCursor },
    );

    yield* bindSessionToThread(startedSession);
    threadBotWorkspaceKeys.set(threadId, botWorkspaceKey);
    threadRespondingBotIds.set(threadId, respondingBotId);
    threadMcpServers.set(threadId, mcpServers);

    return { threadId: startedSession.threadId, engine: desiredEngine };
  });

  const buildSendTurnRequestForThread = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
    readonly modelSelection?: ModelSelection;
    readonly hiddenWake?: boolean;
    readonly timezone?: string;
    readonly authorPersonId?: AuthSessionId | null;
    readonly createdAt: string;
  }) {
    const thread = yield* resolveThreadShell(input.threadId);

    if (!thread) {
      return yield* Effect.die(
        new Error(`Thread '${input.threadId}' was not found in read model.`),
      );
    }

    const ensured = yield* ensureSessionForThread(input.threadId, input.createdAt, {
      ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
      pendingTurnStart: true,
    });

    if (input.modelSelection !== undefined || ensured.engine.configured) {
      threadModelSelections.set(input.threadId, ensured.engine.modelSelection);
    }

    const normalizedInput = toNonEmptyProviderInput(
      yield* expandComposerMentions(input.threadId, input.messageText),
    );

    const normalizedAttachments = input.attachments ?? [];

    const group =
      thread.groupId != null && projectionSnapshotQuery.getGroupById
        ? Option.getOrUndefined(yield* projectionSnapshotQuery.getGroupById(thread.groupId))
        : undefined;

    const memory = chatMemory(thread, group);
    const botId = thread.botId;

    // Otto: a task wake acts for the task's owner; with no person, whoever started the chat
    // (a routine's owner for its runs).
    const taskOwner =
      input.authorPersonId || !botId || !input.threadId.startsWith("task-")
        ? undefined
        : ((yield* projectionSnapshotQuery.getCommandReadModel()).tasks ?? []).find(
            (task) => taskChatId(task.id, botId) === input.threadId,
          )?.owner;

    const askerPersonId =
      input.authorPersonId ??
      (taskOwner?.kind === "person" ? taskOwner.personId : (thread.createdBy ?? null));

    const activeSession = yield* agentController
      .listSessions()
      .pipe(
        Effect.map((sessions) => sessions.find((session) => session.threadId === input.threadId)),
      );

    const sessionModelSwitch =
      activeSession === undefined
        ? "in-session"
        : activeSession.providerInstanceId === undefined
          ? yield* new ProviderAdapterRequestError({
              provider: providerErrorLabel(activeSession.provider),
              method: "thread.turn.start",
              detail: `Active provider session '${activeSession.threadId}' is missing a provider instance id.`,
            })
          : activeSession.providerInstanceId === ensured.engine.modelSelection.instanceId
            ? ensured.engine.capabilities.sessionModelSwitch
            : "unsupported";

    const requestedModelSelection = ensured.engine.modelSelection;

    // The resolved engine wins when the request only repeated the selection
    // stored on the chat. That copy is not the model this turn runs.
    const modelForTurn =
      sessionModelSwitch === "unsupported" &&
      input.modelSelection === undefined &&
      activeSession?.model !== undefined
        ? {
            ...requestedModelSelection,
            model: activeSession.model,
          }
        : requestedModelSelection;

    return {
      threadId: input.threadId,
      ...(normalizedInput ? { input: normalizedInput } : {}),
      ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
      ...(modelForTurn !== undefined ? { modelSelection: modelForTurn } : {}),
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      ...(input.hiddenWake !== undefined ? { hiddenWake: input.hiddenWake } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(memory ? { memory } : {}),
      askerPersonId,
    };
  });

  return {
    reconcileRestrictiveSessionCleanup,
    ensureSessionForThread,
    buildSendTurnRequestForThread,
  };
}
