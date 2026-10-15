import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { BotThreadLanding } from "../components/roster/BotThreadLanding";
import { ChatDetailsPanel } from "../components/roster/ChatDetailsPanel";
import { useRoutedChat } from "../components/roster/chatNavigation";
import { GroupThreadLanding } from "../components/roster/GroupThreadLanding";
import { useAllEnvironmentShellsBootstrapped, useThreadShell } from "../state/entities";

/**
 * Otto: A chat is a chat, DM or group, at one address. The thread says who it is with; a chat
 * that is gone, or never was, leaves for home.
 */
function ChatRouteView() {
  const navigate = useNavigate();
  const chat = useRoutedChat();
  const shell = useThreadShell(chat?.threadRef ?? null);
  const bootstrapped = useAllEnvironmentShellsBootstrapped();

  const gone =
    chat !== null &&
    bootstrapped &&
    (shell === null ||
      shell.archivedAt !== null ||
      shell.parentThreadId != null ||
      (shell.botId == null && shell.groupId == null));

  useEffect(() => {
    if (gone) void navigate({ to: "/", replace: true });
  }, [gone, navigate]);

  if (chat === null || shell === null || gone) return null;

  return (
    <>
      {chat.groupId !== null ? (
        <GroupThreadLanding
          key={chat.threadRef.threadId}
          groupId={chat.groupId}
          threadRef={chat.threadRef}
        />
      ) : chat.botId !== null ? (
        <BotThreadLanding
          key={chat.threadRef.threadId}
          botId={chat.botId}
          threadRef={chat.threadRef}
        />
      ) : null}
      <ChatDetailsPanel threadRef={chat.threadRef} botId={chat.botId} groupId={chat.groupId} />
    </>
  );
}

export const Route = createFileRoute("/_chat/chats/$threadId")({
  component: ChatRouteView,
});
