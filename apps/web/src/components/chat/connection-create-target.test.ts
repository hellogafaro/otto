import { describe, expect, it } from "vite-plus/test";

import { connectionCreateTarget } from "./connection-create-target";

describe("connectionCreateTarget", () => {
  it("names a catalog plugin, not the raw id", () => {
    const target = connectionCreateTarget({ pluginId: "exa" });

    expect(target?.name).toBe("Exa");
    expect(target?.detail).toBeTruthy();
    expect(target?.logoUrl).toBeTruthy();
  });

  it("keeps an unknown plugin id as the name", () => {
    expect(connectionCreateTarget({ pluginId: "not-a-plugin" })).toEqual({
      name: "not-a-plugin",
      detail: null,
      logoUrl: undefined,
    });
  });

  it("names a remote server by its title and host", () => {
    expect(
      connectionCreateTarget({
        title: "Infisical",
        url: "https://mcp.infisical.com/sse",
      }),
    ).toEqual({
      name: "Infisical",
      detail: "mcp.infisical.com",
      logoUrl: undefined,
    });
  });

  it("returns null when the args name nothing", () => {
    expect(connectionCreateTarget({})).toBeNull();
    expect(connectionCreateTarget(null)).toBeNull();
    expect(connectionCreateTarget({ url: "https://example.com" })).toBeNull();
  });
});
