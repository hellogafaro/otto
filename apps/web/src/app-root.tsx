import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/electron-browser-host";
import { QuitHoldOverlay } from "./components/quit-hold-overlay";
import { AppAtomRegistryProvider } from "./rpc/atom-registry";
import type { AppRouter } from "./router";

/**
 * Owns renderer-wide providers. The Electron browser host intentionally sits
 * outside the router so its webviews survive route transitions, but it must
 * share the same atom registry as routed UI.
 */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
      <ElectronBrowserHost />
      <QuitHoldOverlay />
    </AppAtomRegistryProvider>
  );
}
