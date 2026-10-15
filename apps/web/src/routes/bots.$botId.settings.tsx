import { createFileRoute, redirect } from "@tanstack/react-router";

// Otto: a bot's settings moved under Settings > Bots; old links land there.
export const Route = createFileRoute("/bots/$botId/settings")({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/settings/bots/$botId",
      params: { botId: params.botId },
      hash: location.hash,
      replace: true,
    });
  },
});
