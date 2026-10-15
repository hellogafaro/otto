import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { readDesktopPrimaryBearerToken, storeDesktopSessionToken } from "./desktop-auth";

function installWindow(desktop: boolean) {
  const items = new Map<string, string>();

  vi.stubGlobal("window", {
    ...(desktop ? { desktopBridge: {} } : {}),
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    },
  });
}

describe("desktop primary auth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the signed-in account session for the desktop renderer", async () => {
    installWindow(true);
    await expect(readDesktopPrimaryBearerToken()).resolves.toBeNull();

    storeDesktopSessionToken("account-session-token");
    await expect(readDesktopPrimaryBearerToken()).resolves.toBe("account-session-token");

    storeDesktopSessionToken(null);
    await expect(readDesktopPrimaryBearerToken()).resolves.toBeNull();
  });

  it("does not require desktop auth in a browser", async () => {
    installWindow(false);
    storeDesktopSessionToken("ignored");
    await expect(readDesktopPrimaryBearerToken()).resolves.toBeNull();
  });
});
