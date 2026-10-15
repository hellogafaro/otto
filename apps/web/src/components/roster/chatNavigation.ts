import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@otto/client-runtime/environment";
import {
  BotId,
  GroupId,
  PLACEHOLDER_THREAD_TITLE,
  ThreadId,
  type ProjectId,
  type ScopedThreadRef,
  type Visibility,
} from "@otto/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Predicate } from "effect";
import { useCallback, useMemo } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useI18n } from "../../i18n";
import { newThreadId } from "../../lib/utils";
import { resolveAppModelSelectionState } from "../../modelSelection";
import {
  readThreadShells,
  useProjects,
  useThreadShell,
  waitForThreadShell,
} from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { primaryServerCwdAtom, primaryServerProvidersAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { toastManager } from "../ui/toast";
import {
  chatHomeProject,
  findLatestBotThreadTarget,
  findLatestGroupThreadTarget,
} from "./botThreadRuntime.logic";
import { useRosterStore } from "./rosterStore";
import { threadTitle } from "./threadRuntimeAttachments";

const SHELL_ARRIVAL_MS = 10_000;

/** Who a chat is with: one bot (a DM) or a group. */
export type ChatOwner =
  | { readonly kind: "bot"; readonly id: string }
  | { readonly kind: "group"; readonly id: string };

export interface CreateChatOptions {
  /** Where the chat is filed; the home project ("No project") when left out. */
  readonly projectId?: ProjectId;
  /** The chat's title; the New chat placeholder, which its first message replaces, when left out. */
  readonly title?: string;
  /** Who sees a DM; the server keeps it to its creator when left out. */
  readonly visibility?: Visibility;
}

export interface StartChatOptions extends CreateChatOptions {
  /** The first message, sent by the chat once it opens. */
  readonly prompt?: string;
  /** Sends the first message without showing it, as a new bot's introduction does. */
  readonly hidden?: boolean;
  readonly replace?: boolean;
}

/**
 * Otto: Every chat is created here, before anyone sees it: the thread exists, with its bot or
 * group and project, once its shell has arrived.
 */
export function useCreateChat() {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const settings = usePrimarySettings();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const serverCwd = useAtomValue(primaryServerCwdAtom);
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });

  return useCallback(
    async (owner: ChatOwner, options: CreateChatOptions = {}): Promise<ThreadId | null> => {
      const scoped = projects.filter((project) => project.environmentId === environmentId);

      const project =
        scoped.find((candidate) => candidate.id === options.projectId) ??
        chatHomeProject(
          scoped,
          serverCwd,
          () => sortScopedProjectsForSidebar(scoped, readThreadShells(), "updated_at")[0] ?? null,
        );

      if (environmentId === null || project === null) {
        toastManager.add({ type: "error", title: t("Could not start the chat") });

        return null;
      }

      const bot =
        owner.kind === "bot"
          ? useRosterStore.getState().bots.find((candidate) => candidate.id === owner.id)
          : undefined;

      const threadId = newThreadId();

      const result = await createThread({
        environmentId,
        input: {
          threadId,
          projectId: project.id,
          ...(owner.kind === "bot"
            ? { botId: BotId.make(owner.id) }
            : { groupId: GroupId.make(owner.id) }),
          title: options.title ?? PLACEHOLDER_THREAD_TITLE,
          ...(owner.kind === "bot" && options.visibility ? { visibility: options.visibility } : {}),
          modelSelection:
            project.defaultModelSelection ?? resolveAppModelSelectionState(settings, providers),
          runtimeMode: bot?.runtimeMode ?? settings.localExecutionMode,
          interactionMode: DEFAULT_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          createdAt: new Date().toISOString(),
        },
      });

      // The chat is ready once its shell arrives, so its page never shows a chat that is not there.
      if (
        Predicate.isTagged(result, "Failure") ||
        !(await waitForThreadShell(scopeThreadRef(environmentId, threadId), SHELL_ARRIVAL_MS))
      ) {
        toastManager.add({ type: "error", title: t("Could not start the chat") });

        return null;
      }

      return threadId;
    },
    [createThread, environmentId, projects, providers, serverCwd, settings, t],
  );
}

/** Creates a chat and opens it at its one address, /chats/$threadId, with its first message. */
export function useStartChat() {
  const navigate = useNavigate();
  const createChat = useCreateChat();

  return useCallback(
    async (owner: ChatOwner, options: StartChatOptions = {}): Promise<ThreadId | null> => {
      // A shown first message names the chat; a hidden one leaves the placeholder.
      const title =
        options.title ??
        (options.prompt && !options.hidden ? threadTitle(options.prompt, []) : undefined);

      const threadId = await createChat(owner, {
        ...(options.projectId ? { projectId: options.projectId } : {}),
        ...(title ? { title } : {}),
        ...(options.visibility ? { visibility: options.visibility } : {}),
      });

      if (threadId === null) return null;

      if (options.prompt) {
        useRosterStore.getState().requestPrompt({
          threadId,
          text: options.prompt,
          ...(options.hidden ? { hidden: true } : {}),
        });
      }

      void navigate({
        to: "/chats/$threadId",
        params: { threadId },
        ...(options.replace ? { replace: true } : {}),
      });

      return threadId;
    },
    [createChat, navigate],
  );
}

/** Opens the latest chat with a bot or group, or starts its first one. */
export function useOpenChat() {
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const startChat = useStartChat();

  return useCallback(
    async (owner: ChatOwner, options: { readonly replace?: boolean } = {}): Promise<boolean> => {
      if (environmentId === null) return false;
      const shells = readThreadShells();

      const latest =
        owner.kind === "bot"
          ? findLatestBotThreadTarget(owner.id, environmentId, shells)
          : findLatestGroupThreadTarget(owner.id, environmentId, shells);

      if (latest === null) return (await startChat(owner, options)) !== null;

      void navigate({
        to: "/chats/$threadId",
        params: { threadId: latest.threadId },
        ...(options.replace ? { replace: true } : {}),
      });

      return true;
    },
    [environmentId, navigate, startChat],
  );
}

/** The chat the route shows, and who it is with; null away from /chats. */
export function useRoutedChat(): {
  readonly threadRef: ScopedThreadRef;
  readonly botId: string | null;
  readonly groupId: string | null;
} | null {
  const threadId = useParams({ strict: false, select: (params) => params.threadId ?? null });
  const environmentId = usePrimaryEnvironmentId();

  const threadRef = useMemo(
    () =>
      environmentId && threadId ? scopeThreadRef(environmentId, ThreadId.make(threadId)) : null,
    [environmentId, threadId],
  );

  const shell = useThreadShell(threadRef);

  return useMemo(
    () =>
      threadRef
        ? { threadRef, botId: shell?.botId ?? null, groupId: shell?.groupId ?? null }
        : null,
    [shell?.botId, shell?.groupId, threadRef],
  );
}
