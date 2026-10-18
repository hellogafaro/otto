import { RiInboxUnarchiveLine, RiDeleteBinLine } from "@remixicon/react";
import { Match } from "effect";
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@otto/client-runtime/environment";
import type { EnvironmentId } from "@otto/contracts";

import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useChatActions } from "../../hooks/use-chat-actions";
import { useI18n } from "../../i18n";
import { useArchivedThreadSnapshots } from "../../lib/archived-threads-state";
import { closeSettings, useSettingsEnvironmentId } from "../../settings-dialog-store";
import { environmentBotsAtom, environmentGroupsAtom } from "../../state/bots";
import { Button } from "../ui/button";
import { SkeletonSettingsSections } from "../ui/skeleton";
import { ArchivedBotsSection } from "./archived-bots-settings";
import { buildArchivedChatSections, type ArchivedChat } from "./archived-chats-settings.logic";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settings-layout";

/** Settings > Archived: archived bots, then every archived chat on this environment, by bot or group. */
export function ArchivedChatsSettingsPanel() {
  const { t } = useI18n();
  const environmentId = useSettingsEnvironmentId();

  return (
    <SettingsPageContainer>
      {environmentId === null ? (
        <SettingsSection id="archived-chats" title={t("Archived chats")}>
          <SettingsRow
            title={t("No environment")}
            description={t("Connect to an environment to see its archived chats.")}
          />
        </SettingsSection>
      ) : (
        <>
          <ArchivedBotsSection key={`bots-${environmentId}`} environmentId={environmentId} />
          <ArchivedChatsContent key={environmentId} environmentId={environmentId} />
        </>
      )}
    </SettingsPageContainer>
  );
}

function ArchivedChatsContent({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { t, formatDate } = useI18n();
  const actions = useChatActions();
  const navigate = useNavigate();
  const environmentIds = useMemo(() => [environmentId], [environmentId]);
  const { snapshots, error, isLoading } = useArchivedThreadSnapshots(environmentIds);
  const bots = useAtomValue(environmentBotsAtom(environmentId));
  const groups = useAtomValue(environmentGroupsAtom(environmentId));
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);

  const sections = useMemo(
    () =>
      buildArchivedChatSections({
        environmentId,
        snapshot:
          snapshots.find((entry) => entry.environmentId === environmentId)?.snapshot ?? null,
        bots,
        groups,
      }),
    [bots, environmentId, groups, snapshots],
  );

  const run = async (chat: ArchivedChat, action: "unarchive" | "delete") => {
    const threadRef = scopeThreadRef(chat.environmentId, chat.threadId);
    setBusyThreadId(chat.threadId);

    try {
      if (action === "unarchive") await actions.unarchive(threadRef);
      else await actions.delete(threadRef);
    } finally {
      setBusyThreadId(null);
    }
  };

  if (sections.length === 0 && isLoading) {
    return <SkeletonSettingsSections label={t("Loading archive…")} sections={[4]} />;
  }

  if (sections.length === 0) {
    return (
      <SettingsSection id="archived-chats" title={t("Archived chats")}>
        <SettingsRow
          title={error ? t("Could not load archived chats") : t("No archived chats")}
          description={
            error
              ? t("Check the connection to this environment, then reopen this page.")
              : t("Chats you archive will appear here.")
          }
        />
      </SettingsSection>
    );
  }

  // A failed refresh keeps the last archive on screen, so say it may be stale.
  const refreshError = error ? (
    <div role="alert" className="space-y-0.5 px-1 text-xs text-destructive-foreground">
      <p className="font-medium">{t("Could not load archived chats")}</p>
      <p>{t("Check the connection to this environment, then reopen this page.")}</p>
    </div>
  ) : null;

  const archiveSections = sections.map((section, index) => (
    <SettingsSection
      key={section.key}
      id={index === 0 ? "archived-chats" : undefined}
      title={
        section.name ??
        Match.value(section).pipe(
          Match.when({ kind: "group" }, () => t("Deleted group")),
          Match.when({ kind: "bot" }, () => t("Removed bot")),
          Match.orElse(() => t("Other chats")),
        )
      }
    >
      {section.chats.map((chat) => {
        const busy = busyThreadId === chat.threadId;

        const archivedAt = formatDate(new Date(chat.archivedAt), {
          dateStyle: "medium",
          timeStyle: "short",
        });

        return (
          <SettingsRow
            key={chat.threadId}
            data-testid="archived-chat-row"
            title={
              // A chat with no bot or group has no page on web to open.
              section.kind === "other" ? (
                chat.title
              ) : (
                <button
                  type="button"
                  className="text-left outline-none hover:underline focus-visible:underline"
                  onClick={() => {
                    closeSettings();
                    void navigate({ to: "/chats/$threadId", params: { threadId: chat.threadId } });
                  }}
                >
                  {chat.title}
                </button>
              )
            }
            description={t("Archived {time}", { time: archivedAt })}
            control={
              <>
                {/* A chat with no bot or group has no page on web, so unarchiving would hide it. */}
                {section.kind === "other" ? null : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(chat, "unarchive")}
                  >
                    <RiInboxUnarchiveLine className="size-3.5" />
                    {t("Unarchive")}
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("Delete {title}", { title: chat.title })}
                  disabled={busy}
                  onClick={() => void run(chat, "delete")}
                >
                  <RiDeleteBinLine className="size-3.5" />
                </Button>
              </>
            }
          />
        );
      })}
    </SettingsSection>
  ));

  return (
    <>
      {refreshError}
      {archiveSections}
    </>
  );
}
