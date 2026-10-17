import { describe, expect, it } from "vite-plus/test";

import { resolveDefaultDesktopUpdateChannel } from "./update-channels.ts";

describe("resolveDefaultDesktopUpdateChannel", () => {
  it("follows the beta feed only for beta release versions", () => {
    expect(resolveDefaultDesktopUpdateChannel("0.1.1-beta.20261018.7")).toBe("beta");
    expect(resolveDefaultDesktopUpdateChannel("0.1.1")).toBe("latest");
    expect(resolveDefaultDesktopUpdateChannel("0.1.1-pr.12.3")).toBe("latest");
    expect(resolveDefaultDesktopUpdateChannel("0.1.1-rc.20261018.7")).toBe("latest");
  });
});
