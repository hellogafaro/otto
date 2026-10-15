import { createFileRoute, redirect } from "@tanstack/react-router";

import { RoutinesPage } from "../components/routines/RoutinesPage";

export const Route = createFileRoute("/routines/")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: RoutinesPage,
});
