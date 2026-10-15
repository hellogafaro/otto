import { createFileRoute } from "@tanstack/react-router";

import { OpenChatRedirect } from "../components/roster/open-chat-redirect";

function GroupChatRedirect() {
  const { groupId } = Route.useParams();

  return <OpenChatRedirect owner={{ kind: "group", id: groupId }} />;
}

/** Otto: a link to a group opens its latest chat, at /chats/$threadId. */
export const Route = createFileRoute("/_chat/groups/$groupId")({
  component: GroupChatRedirect,
});
