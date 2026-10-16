import { createFileRoute, redirect } from "@tanstack/react-router";

import { HomePage } from "../components/home/home-page";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: HomePage,
});
