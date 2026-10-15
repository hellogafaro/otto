import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useAllEnvironmentShellsBootstrapped } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { type ChatOwner, useOpenChat } from "./chat-navigation";
import { isRosterReady } from "./roster-route-selection";
import { useRosterStore } from "./roster-store";

/**
 * Otto: Opens the latest chat with a bot or group, starting its first one when it has none,
 * once the roster and chats have loaded. An owner that is gone leaves for home.
 */
export function OpenChatRedirect({ owner }: { readonly owner: ChatOwner }) {
  const navigate = useNavigate();
  const openChat = useOpenChat();
  const environmentId = usePrimaryEnvironmentId();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const rosterReady = useRosterStore((state) => isRosterReady(environmentId, state.environmentId));

  const exists = useRosterStore((state) =>
    owner.kind === "bot"
      ? state.bots.some((bot) => bot.id === owner.id && bot.archivedAt === null)
      : state.groups.some((group) => group.id === owner.id),
  );

  const opened = useRef(false);

  useEffect(() => {
    if (!bootstrapped || !rosterReady || opened.current) return;
    opened.current = true;

    void (exists ? openChat(owner, { replace: true }) : Promise.resolve(false)).then((open) => {
      if (!open) void navigate({ to: "/", replace: true });
    });
  }, [bootstrapped, exists, navigate, openChat, owner, rosterReady]);

  return null;
}
