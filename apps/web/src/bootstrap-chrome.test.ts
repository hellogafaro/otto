import { describe, expect, it } from "vite-plus/test";

import bootstrapHtml from "../index.html?raw";
import manifestJson from "../public/manifest.webmanifest?raw";

// The static bootstrap shell renders before React mounts, so its branding
// lives in index.html instead of branding.ts and needs its own check.
describe("bootstrap chrome", () => {
  it("brands the static bootstrap shell as Otto", () => {
    expect(bootstrapHtml).toContain("<title>Otto</title>");
    expect(bootstrapHtml).toContain('aria-label="Otto splash screen"');
    expect(bootstrapHtml).toContain('alt="Otto"');
    expect(bootstrapHtml).not.toContain("Otto Legacy");
    expect(bootstrapHtml).not.toContain("ottoLegacy.codes");
    expect(bootstrapHtml).not.toContain("ping.gg");
  });

  it("brands the web app manifest as Otto", () => {
    const manifest = JSON.parse(manifestJson) as { name?: string; short_name?: string };

    expect(manifest.name).toBe("Otto");
    expect(manifest.short_name).toBe("Otto");
  });
});
