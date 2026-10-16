import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const browser = vi.hoisted(() => ({ enabled: false, browserbaseApiKeyRedacted: false }));

vi.mock("~/hooks/use-settings", () => ({
  usePrimarySettings: () => ({ browserProvider: browser }),
  useUpdatePrimarySettings: () => vi.fn(),
}));

import { BrowserSettingsSection } from "./browser-settings";

describe("Browser settings", () => {
  it("offers Connect instead of a Browserbase switch until a key is saved", () => {
    browser.enabled = false;
    browser.browserbaseApiKeyRedacted = false;
    const markup = renderToStaticMarkup(<BrowserSettingsSection />);
    expect(markup).toContain(">Connect</button>");
    expect(markup).not.toContain('aria-label="Use Browserbase"');
    expect(markup).not.toContain('type="password"');

    browser.browserbaseApiKeyRedacted = true;
    const connected = renderToStaticMarkup(<BrowserSettingsSection />);
    expect(connected).not.toContain(">Connect</button>");
    expect(connected).toContain(">Remove</button>");
    expect(connected).toContain('aria-label="Use Browserbase"');
  });

  it("keeps Bot browser access as a plain switch with no status line", () => {
    const markup = renderToStaticMarkup(<BrowserSettingsSection />);
    expect(markup).toContain("Bot browser access");
    expect(markup).not.toContain("Allowed");
    expect(markup).not.toContain("How browser use works");
  });
});
