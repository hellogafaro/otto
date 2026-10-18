import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { BotThreadLanding } from "../components/roster/bot-thread-landing";
import { ChatDetailsPanel } from "../components/roster/chat-details-panel";
import { useRoutedChat } from "../components/roster/chat-navigation";
import { GroupThreadLanding } from "../components/roster/group-thread-landing";
import { useDesktopTabTitle } from "../desktop-tabs-store";
import { useChatShell } from "../lib/archived-threads-state";
import { useAllEnvironmentShellsBootstrapped } from "../state/entities";

/**
 * Otto: A chat is a chat, DM or group, at one address. The thread says who it is with; an
 * archived chat stays open read-only, and a chat that is gone, or never was, leaves for home.
 */
function ChatRouteView() {
  const navigate = useNavigate();
  const chat = useRoutedChat();
  const { shell, pending } = useChatShell(chat?.threadRef ?? null);
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  useDesktopTabTitle(shell?.title);

  const gone =
    chat !== null &&
    bootstrapped &&
    !pending &&
    (shell === null ||
      shell.parentThreadId != null ||
      (shell.botId == null && shell.groupId == null));

  useEffect(() => {
    if (gone) void navigate({ to: "/chats", replace: true });
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
