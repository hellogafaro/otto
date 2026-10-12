import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveServerBackedAppDisplayName } from "./branding.logic";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");

    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it("uses injected desktop branding when available", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "Otto",
            stageLabel: "Dev",
            displayName: "Otto (Dev)",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_BASE_NAME).toBe("Otto");
    expect(branding.APP_STAGE_LABEL).toBe("Dev");
    expect(branding.APP_DISPLAY_NAME).toBe("Otto (Dev)");
  });
});

describe("branding logic", () => {
  it("keeps the fallback display name for stable primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Otto",
        fallbackDisplayName: "Otto (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.27",
      }),
    ).toBe("Otto (Alpha)");
  });
});
