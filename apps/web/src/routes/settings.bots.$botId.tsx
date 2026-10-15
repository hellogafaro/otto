import { createFileRoute } from "@tanstack/react-router";

import { BotSettingsPage } from "../components/roster/BotSettingsPage";

export const Route = createFileRoute("/settings/bots/$botId")({
  component: () => <BotSettingsPage botId={Route.useParams().botId} />,
});
