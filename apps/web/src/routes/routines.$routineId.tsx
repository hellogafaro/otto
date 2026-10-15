import { RoutineId } from "@otto/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { RoutinePage } from "../components/routines/routine-page";

export const Route = createFileRoute("/routines/$routineId")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function RoutineRoute() {
    return <RoutinePage routineId={RoutineId.make(Route.useParams().routineId)} />;
  },
});
