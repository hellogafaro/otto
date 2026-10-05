import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { LoginPage } from "@/routes/login";
import { ModelsPage } from "@/routes/models";
import { SettingsLayout } from "@/routes/settings";
import { useRpcState } from "@/lib/rpc";
import { Spinner } from "@workspace/ui/components/spinner";

function Gate() {
  const state = useRpcState();
  if (state.phase === "login") return <LoginPage error={state.error} />;
  if (state.phase === "error")
    return (
      <main className="flex min-h-svh items-center justify-center p-6 text-sm">
        {state.message}
      </main>
    );
  if (state.phase === "loading")
    return (
      <main className="flex min-h-svh items-center justify-center">
        <Spinner />
      </main>
    );
  return <Shell />;
}

const rootRoute = createRootRoute({ component: Gate });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/settings/$section" params={{ section: "models" }} />,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsLayout,
});
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  component: () => <Navigate to="/settings/$section" params={{ section: "models" }} />,
});
const sectionRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "$section",
  component: ModelsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  settingsRoute.addChildren([settingsIndexRoute, sectionRoute]),
]);
export const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
export { Outlet };
