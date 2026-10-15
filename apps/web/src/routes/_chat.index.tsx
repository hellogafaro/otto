import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import { BotZeroState } from "../components/roster/BotZeroState";
import { useOpenChat } from "../components/roster/chatNavigation";
import { resolveRosterBotId } from "../components/roster/roster.logic";
import { isRosterReady } from "../components/roster/rosterRouteSelection";
import { RosterLoadStatus } from "../components/roster/RosterLoadStatus";
import { useRosterStore } from "../components/roster/rosterStore";
import { useRosterLoadState } from "../components/roster/useServerRoster";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { useAllEnvironmentShellsBootstrapped, useThreadShells } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";

/** Otto: home opens your latest chat, else a chat with the bot you last talked to. */
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

  const opens = rosterReady && bootstrapped && (latestThreadId !== null || botId !== null);

  useEffect(() => {
    if (!opens || opened.current) return;
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
  }, [botId, latestThreadId, navigate, openChat, opens]);

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

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRedirect,
});
