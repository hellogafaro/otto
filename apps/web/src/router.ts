import { createRouter, RouterHistory } from "@tanstack/react-router";

import { TranslatedRouteErrorView } from "./routes/-root-route-error-view";
import { routeTree } from "./routeTree.gen";

export function getRouter(history: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    context: {},
    defaultErrorComponent: TranslatedRouteErrorView,
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
