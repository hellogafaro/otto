import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

function ChatRouteLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: ChatRouteLayout,
});
