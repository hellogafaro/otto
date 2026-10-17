import { Children, isValidElement } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { ElectronBrowserHost } from "./browser/electron-browser-host";
import { QuitHoldOverlay } from "./components/quit-hold-overlay";
import { AppAtomRegistryProvider } from "./rpc/atom-registry";
import type { AppRouter } from "./router";
import { AppRoot } from "./app-root";

describe("AppRoot", () => {
  it("shares the application atom registry with routed UI and renderer-wide desktop hosts", () => {
    const root = AppRoot({ router: {} as AppRouter });

    expect(root.type).toBe(AppAtomRegistryProvider);

    const children = Children.toArray(root.props.children);

    expect(children).toHaveLength(3);
    expect(isValidElement(children[0]) && children[0].type).toBe(RouterProvider);
    expect(isValidElement(children[1]) && children[1].type).toBe(ElectronBrowserHost);
    expect(isValidElement(children[2]) && children[2].type).toBe(QuitHoldOverlay);
  });
});
