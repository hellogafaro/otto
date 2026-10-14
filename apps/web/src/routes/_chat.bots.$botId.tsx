import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { BotThreadLanding } from "../components/roster/BotThreadLanding";
import { BotDetailsPanel } from "../components/roster/BotDetailsPanel";
import { useBotThreadRef } from "../components/roster/useBotThreadRef";
import { resolveRoutedBot } from "../components/roster/rosterRouteSelection";
import { useRosterStore } from "../components/roster/rosterStore";
import { botRoutePanelKeys } from "./-botRoutePanelKeys";
import { usePrimaryEnvironmentId } from "../state/environments";

function BotThreadRouteView() {
  const { botId } = Route.useParams();
  const panelKeys = botRoutePanelKeys(botId);
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  /*
   * The roster store is not scoped to the active environment, so a bot found by
   * id alone can still belong to the environment we just left. Judging the id
   * only once the store mirrors this environment keeps the panel from showing
   * one environment's bot while its saves address another.
   */
  const bots = useRosterStore((state) => state.bots);
  const rosterEnvironmentId = useRosterStore((state) => state.environmentId);
  const routedBot = resolveRoutedBot(environmentId, rosterEnvironmentId, bots, botId);
  const bot = routedBot.status === "available" ? routedBot.bot : null;
  const threadRef = useBotThreadRef(botId);

  return (
    <>
      <BotThreadLanding key={panelKeys.thread} botId={botId} />
      {bot ? (
        <BotDetailsPanel
          key={panelKeys.details}
          bot={bot}
          threadRef={threadRef}
          onOpenSettings={() => {
            void navigate({ to: "/bots/$botId/settings", params: { botId } });
          }}
        />
      ) : null}
    </>
  );
}

export const Route = createFileRoute("/_chat/bots/$botId")({
  component: BotThreadRouteView,
});
