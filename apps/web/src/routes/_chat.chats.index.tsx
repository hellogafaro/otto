import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import { BotZeroState } from "../components/roster/bot-zero-state";
import { useOpenChat } from "../components/roster/chat-navigation";
import { resolveRosterBotId } from "../components/roster/roster.logic";
import { isRosterReady } from "../components/roster/roster-route-selection";
import { RosterLoadStatus } from "../components/roster/roster-load-status";
import { useRosterStore } from "../components/roster/roster-store";
import { useRosterLoadState } from "../components/roster/use-server-roster";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/workspace-page-header";
import { useAllEnvironmentShellsBootstrapped, useThreadShells } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";

/** Otto: Chats opens your latest chat, else a chat with the bot you last talked to. */
function ChatIndexRedirect() {
  const navigate = useNavigate();
  const openChat = useOpenChat();
  const environmentId = usePrimaryEnvironmentId();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const rosterEnvironmentId = useRosterStore((state) => state.environmentId);
  const rosterReady = isRosterReady(environmentId, rosterEnvironmentId);
  const botId = useRosterStore((state) => resolveRosterBotId(state.selectedBotId, state.bots));
  const loadState = useRosterLoadState();
  const shells = useThreadShells();
  const opened = useRef(false);

  const latestThreadId = useMemo(
    () =>
      shells
        .filter(
          (shell) =>
            shell.environmentId === environmentId &&
            (shell.botId != null || shell.groupId != null) &&
            shell.parentThreadId == null &&
            shell.archivedAt === null,
        )
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.id ?? null,
    [environmentId, shells],
  );

  const ready = rosterReady && bootstrapped;
  const opens = ready && (latestThreadId !== null || botId !== null);

  // Otto: decides once, when everything has loaded. A bot created from the empty state opens
  // its own introduction chat, so its arrival must not start a second chat here.
  useEffect(() => {
    if (!ready || opened.current) return;
    opened.current = true;

    if (latestThreadId !== null) {
      void navigate({
        to: "/chats/$threadId",
        params: { threadId: latestThreadId },
        replace: true,
      });

      return;
    }

    if (botId !== null) void openChat({ kind: "bot", id: botId }, { replace: true });
  }, [botId, latestThreadId, navigate, openChat, ready]);

  if (opens || (rosterReady && !bootstrapped)) return null;

  return (
    <SidebarInset tone="foreground" className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader className="border-b border-border" />
        {rosterReady ? <BotZeroState /> : <RosterLoadStatus state={loadState} variant="page" />}
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/chats/")({
  component: ChatIndexRedirect,
});
