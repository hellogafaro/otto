import { createFileRoute } from "@tanstack/react-router";

import { OpenChatRedirect } from "../components/roster/OpenChatRedirect";

function BotChatRedirect() {
  const { botId } = Route.useParams();

  return <OpenChatRedirect owner={{ kind: "bot", id: botId }} />;
}

/** Otto: a link to a bot opens your latest chat with it, at /chats/$threadId. */
export const Route = createFileRoute("/_chat/bots/$botId")({
  component: BotChatRedirect,
});
