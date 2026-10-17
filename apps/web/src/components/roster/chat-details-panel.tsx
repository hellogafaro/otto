import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@otto/client-runtime/environment";
import { BotId, type ScopedThreadRef, GENERAL_PROJECT_ID } from "@otto/contracts";
import { RiArrowRightSLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useChatActions } from "../../hooks/use-chat-actions";
import { useI18n } from "../../i18n";
import { environmentPeopleAtom } from "../../state/bots";
import { useProject, useThreadShell } from "../../state/entities";
import { memoryEnvironment } from "../../state/memory";
import { useEnvironmentQuery } from "../../state/query";
import { DetailsAside, DetailsGroup, DetailsRow } from "../details-aside";
import { LibraryVisibilitySelect } from "../library/library-actions";
import { ChatLibrarySection } from "../library/chat-library-section";
import { Button } from "../ui/button";
import { BotAvatarView } from "./bot-avatar-view";
import { BotMemorySheet } from "./bot-memory-sheet";
import { useChatDetailsOpen } from "./details-panel-open";
import { GroupEditor } from "./group-editor";
import { PersonAvatar } from "./person-avatar";
import { useRosterStore } from "./roster-store";

/**
 * Otto: The details panel belongs to the chat, DM or group: the project it is filed in, who is
 * in it and, when it has any, the files saved from it. A bot's own configuration lives in
 * Settings, Bots.
 */
export function ChatDetailsPanel({
  threadRef,
  botId,
  groupId,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly botId: string | null;
  readonly groupId: string | null;
}) {
  const { t, plural } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useChatDetailsOpen();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const shell = useThreadShell(threadRef);
  const people = useAtomValue(environmentPeopleAtom(threadRef.environmentId));
  const chatActions = useChatActions();

  const project = useProject(
    shell ? scopeProjectRef(threadRef.environmentId, shell.projectId) : null,
  );

  const { bots, group } = useRosterStore(
    useShallow((state) => ({
      bots: state.bots,
      group: state.groups.find((candidate) => candidate.id === groupId) ?? null,
    })),
  );

  const bot = bots.find((candidate) => candidate.id === botId) ?? null;

  const memories = useEnvironmentQuery(
    bot && open
      ? memoryEnvironment.list({
          environmentId: threadRef.environmentId,
          input: { botId: BotId.make(bot.id) },
        })
      : null,
  );

  // What this bot remembers that you can see: about you, itself and the chats you share.
  const memoryCount = memories.data?.sections.reduce(
    (total, section) =>
      total + section.memories.filter((memory) => memory.status === "active").length,
    0,
  );

  // The General project reads as "No project", as in New chat.
  const projectLabel =
    project === null || project.id === GENERAL_PROJECT_ID ? t("No project") : project.title;

  const chatProperties = (
    <DetailsGroup id="chat-properties" label={t("Chat")}>
      <DetailsRow label={t("Project")}>
        <span className="truncate px-2.5 text-sm text-foreground">{projectLabel}</span>
      </DetailsRow>
      {group === null && shell ? (
        <DetailsRow label={t("Visibility")}>
          <LibraryVisibilitySelect
            value={shell.visibility ?? "organization"}
            editable={shell.createdBy != null && shell.createdBy === people.current?.id}
            onChange={(visibility) => void chatActions.setVisibility(threadRef, visibility)}
          />
        </DetailsRow>
      ) : null}
      {bot ? (
        <DetailsRow label={t("Memory")}>
          <Button size="sm" variant="ghost" onClick={() => setMemoryOpen(true)}>
            {memoryCount === undefined
              ? t("View")
              : plural(memoryCount, { one: "{count} memory", other: "{count} memories" })}
            <RiArrowRightSLine aria-hidden />
          </Button>
        </DetailsRow>
      ) : null}
    </DetailsGroup>
  );

  const library = <ChatLibrarySection threadId={threadRef.threadId} className="mt-6" />;

  const details =
    group !== null ? (
      <GroupEditor
        environmentId={threadRef.environmentId}
        group={group}
        bots={bots}
        onDeleted={() => void navigate({ to: "/chats" })}
        trailing={library}
      >
        {chatProperties}
      </GroupEditor>
    ) : bot !== null ? (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          <div className="flex flex-col items-start gap-1 pb-6 pt-2">
            <BotAvatarView avatar={bot.avatar} name={bot.name} className="mb-2 size-16" />
            <h2 className="max-w-full truncate text-base font-medium">{bot.name}</h2>
            {bot.label ? <span className="text-sm text-muted-foreground">{bot.label}</span> : null}
          </div>
          {chatProperties}
          <div className="mt-6">
            <DetailsGroup id="chat-members" label={t("Members")}>
              <div className="flex min-h-9 items-center gap-2">
                <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-6" />
                <span className="min-w-0 flex-1 truncate text-sm">{bot.name}</span>
              </div>
              {people.current ? (
                <div className="flex min-h-9 items-center gap-2">
                  <PersonAvatar name={people.current.displayName} className="size-6" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {people.current.displayName}
                  </span>
                </div>
              ) : null}
            </DetailsGroup>
          </div>
          {library}
        </div>
        <BotMemorySheet
          open={memoryOpen}
          onOpenChange={setMemoryOpen}
          environmentId={threadRef.environmentId}
          botId={BotId.make(bot.id)}
          botName={bot.name}
        />
      </>
    ) : null;

  return (
    <DetailsAside
      open={open}
      onOpenChange={setOpen}
      testId="chat-details-panel"
      labels={{
        sidebar: t("Chat sidebar"),
        open: t("Open chat sidebar"),
        collapse: t("Collapse chat sidebar"),
        close: t("Close chat sidebar"),
        sheetTitle: t("Chat"),
      }}
    >
      {details}
    </DetailsAside>
  );
}
