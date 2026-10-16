import { createFileRoute, redirect } from "@tanstack/react-router";

// Otto: Channels are coming soon, so a channel has no page yet; old links land on Channels.
export const Route = createFileRoute("/settings/channels/$channel")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/$section", params: { section: "channels" }, replace: true });
  },
});
