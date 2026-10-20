import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@otto/client-runtime/environment";
import {
  AuthSessionId,
  BotId,
  DEFAULT_TEXT_GENERATION_MODEL,
  GroupId,
  PLACEHOLDER_THREAD_TITLE,
  ProviderInstanceId,
  ThreadId,
  type EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
  type Visibility,
} from "@otto/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Match, Predicate } from "effect";
import { useCallback, useMemo } from "react";

import { usePrimarySettings } from "../../hooks/use-settings";
import { useI18n } from "../../i18n";
import { newThreadId } from "../../lib/utils";
import { resolveAppModelSelectionState } from "../../model-selection";
import { readThreadShells, useProjects, waitForThreadShell } from "../../state/entities";
import { useChatShell } from "../../lib/archived-threads-state";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { primaryServerProvidersAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import { sortScopedProjectsForSidebar } from "../sidebar.logic";
import { toast } from "sonner";
import { DEFAULT_BOT_RUNTIME_MODE } from "./bot-sandbox";
import {
  chatHomeProject,
  findLatestBotThreadTarget,
  findLatestGroupThreadTarget,
  findLatestPersonThreadTarget,
} from "./bot-thread-runtime.logic";
import { useRosterStore } from "./roster-store";
import { appAtomRegistry } from "../../rpc/atom-registry";
import { environmentSnapshotAtom } from "../../state/shell";
import { threadTitle } from "./thread-runtime-attachments";

const SHELL_ARRIVAL_MS = 10_000;

/**
 * Otto: No bot answers a person DM, so its model is never run; a fixed valid one keeps the chat
 * startable when no provider is connected.
 */
const PERSON_DM_MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: DEFAULT_TEXT_GENERATION_MODEL,
};

/** The signed-in person in an environment, for finding their DMs with other people. */
const readCurrentPersonId = (environmentId: EnvironmentId) =>
  appAtomRegistry.get(environmentSnapshotAtom(environmentId))?.currentPersonId ?? null;

/** Who a chat is with: one bot (a DM), a group, or one other person (a person DM). */
export type ChatOwner =
  | { readonly kind: "bot"; readonly id: string }
  | { readonly kind: "group"; readonly id: string }
  | { readonly kind: "person"; readonly id: string };

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
  /** Files sent with the first message. */
  readonly files?: readonly File[];
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
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });

  return useCallback(
    async (owner: ChatOwner, options: CreateChatOptions = {}): Promise<ThreadId | null> => {
      const scoped = projects.filter((project) => project.environmentId === environmentId);

      const project =
        scoped.find((candidate) => candidate.id === options.projectId) ??
        chatHomeProject(
          scoped,
          () => sortScopedProjectsForSidebar(scoped, readThreadShells(), "updated_at")[0] ?? null,
        );

      if (environmentId === null || project === null) {
        toast.error(t("Chat couldn't be started"));

        return null;
      }

      const threadId = newThreadId();

      const result = await createThread({
        environmentId,
        input: {
          threadId,
          projectId: project.id,
          ...Match.value(owner).pipe(
            Match.when({ kind: "bot" }, ({ id }) => ({ botId: BotId.make(id) })),
            Match.when({ kind: "group" }, ({ id }) => ({ groupId: GroupId.make(id) })),
            Match.when({ kind: "person" }, ({ id }) => ({ personId: AuthSessionId.make(id) })),
            Match.exhaustive,
          ),
          title: options.title ?? PLACEHOLDER_THREAD_TITLE,
          ...(owner.kind === "bot" && options.visibility ? { visibility: options.visibility } : {}),
          modelSelection:
            owner.kind === "person"
              ? PERSON_DM_MODEL_SELECTION
              : resolveAppModelSelectionState(settings, providers),
          runtimeMode: DEFAULT_BOT_RUNTIME_MODE,
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
        toast.error(t("Chat couldn't be started"));

        return null;
      }

      return threadId;
    },
    [createThread, environmentId, projects, providers, settings, t],
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
        (options.prompt && !options.hidden
          ? threadTitle(options.prompt, options.files ?? [])
          : undefined);

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
          ...(options.files?.length ? { files: options.files } : {}),
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

      const currentPersonId = readCurrentPersonId(environmentId);

      const latest = Match.value(owner).pipe(
        Match.when({ kind: "bot" }, ({ id }) =>
          findLatestBotThreadTarget(id, environmentId, shells),
        ),
        Match.when({ kind: "group" }, ({ id }) =>
          findLatestGroupThreadTarget(id, environmentId, shells),
        ),
        Match.when({ kind: "person" }, ({ id }) =>
          currentPersonId
            ? findLatestPersonThreadTarget(id, currentPersonId, environmentId, shells)
            : null,
        ),
        Match.exhaustive,
      );

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

/**
 * Otto: Opens your DM with another person, starting it when there is none, and sends New chat's
 * first message there.
 */
export function useOpenPersonChat() {
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const startChat = useStartChat();

  return useCallback(
    async (personId: string, options: StartChatOptions = {}): Promise<boolean> => {
      if (environmentId === null) return false;
      const currentPersonId = readCurrentPersonId(environmentId);

      const latest = currentPersonId
        ? findLatestPersonThreadTarget(personId, currentPersonId, environmentId, readThreadShells())
        : null;

      if (latest === null)
        return (await startChat({ kind: "person", id: personId }, options)) !== null;

      const threadId = ThreadId.make(latest.threadId);

      if (options.prompt) {
        useRosterStore.getState().requestPrompt({
          threadId,
          text: options.prompt,
          ...(options.files?.length ? { files: options.files } : {}),
        });
      }

      void navigate({ to: "/chats/$threadId", params: { threadId } });

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
  readonly personDm: boolean;
} | null {
  const threadId = useParams({ strict: false, select: (params) => params.threadId ?? null });
  const environmentId = usePrimaryEnvironmentId();

  const threadRef = useMemo(
    () =>
      environmentId && threadId ? scopeThreadRef(environmentId, ThreadId.make(threadId)) : null,
    [environmentId, threadId],
  );

  const { shell } = useChatShell(threadRef);

  return useMemo(
    () =>
      threadRef
        ? {
            threadRef,
            botId: shell?.botId ?? null,
            groupId: shell?.groupId ?? null,
            personDm: shell?.personId != null,
          }
        : null,
    [shell?.botId, shell?.groupId, shell?.personId, threadRef],
  );
}
