import { DEFAULT_SERVER_SETTINGS } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canSaveSandboxProviderConnection,
  disconnectSandboxProvider,
  isSandboxProviderConnected,
  saveSandboxProviderConnection,
  selectableSandboxProviders,
} from "./sandbox-settings-panel.logic";

describe("sandbox settings", () => {
  it("offers only local until a cloud provider is connected", () => {
    expect(selectableSandboxProviders(DEFAULT_SERVER_SETTINGS.sandbox)).toEqual(["local"]);
  });

  it("offers Boat when the server's environment connects it", () => {
    expect(selectableSandboxProviders(DEFAULT_SERVER_SETTINGS.sandbox, true)).toEqual([
      "local",
      "boat",
    ]);
  });

  it("connects Boat with a sensitive key and clears the default on disconnect", () => {
    const settings = DEFAULT_SERVER_SETTINGS.sandbox;
    expect(canSaveSandboxProviderConnection({ settings, provider: "boat", draft: {} })).toBe(false);

    const connected = saveSandboxProviderConnection({
      settings,
      provider: "boat",
      draft: { BOAT_API_KEY: " boat-secret " },
    });

    expect(connected.providers.boat.environment).toEqual([
      { name: "BOAT_API_KEY", value: "boat-secret", sensitive: true },
    ]);
    expect(isSandboxProviderConnected(connected, "boat")).toBe(true);
    expect(selectableSandboxProviders(connected)).toEqual(["local", "boat"]);

    const disconnected = disconnectSandboxProvider(
      { ...connected, defaultProvider: "boat" },
      "boat",
    );

    expect(disconnected.defaultProvider).toBe("local");
    expect(selectableSandboxProviders(disconnected)).not.toContain("boat");
  });

  it("keeps a redacted Boat key and falls back to local on disconnect", () => {
    const connected = {
      ...saveSandboxProviderConnection({
        settings: DEFAULT_SERVER_SETTINGS.sandbox,
        provider: "boat",
        draft: { BOAT_API_KEY: "secret" },
      }),
      defaultProvider: "boat" as const,
    };

    const redacted = {
      ...connected,
      providers: {
        ...connected.providers,
        boat: {
          environment: [{ name: "BOAT_API_KEY", value: "", sensitive: true, valueRedacted: true }],
        },
      },
    };

    const saved = saveSandboxProviderConnection({
      settings: redacted,
      provider: "boat",
      draft: {},
    });

    expect(saved.providers.boat.environment[0]?.valueRedacted).toBe(true);
    expect(disconnectSandboxProvider(saved, "boat").defaultProvider).toBe("local");
  });
});
