import { createFileRoute, redirect } from "@tanstack/react-router";

import { NotificationsPage } from "../components/notifications/notifications-page";

export const Route = createFileRoute("/notifications")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: NotificationsPage,
});
