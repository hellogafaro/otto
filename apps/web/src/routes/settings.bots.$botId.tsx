import { createFileRoute } from "@tanstack/react-router";

import { BotSettingsPage } from "../components/roster/bot-settings-page";

export const Route = createFileRoute("/settings/bots/$botId")({
  component: () => <BotSettingsPage botId={Route.useParams().botId} />,
});
