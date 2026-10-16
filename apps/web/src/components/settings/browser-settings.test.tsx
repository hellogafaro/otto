import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/hooks/use-settings", () => ({
  usePrimarySettings: () => ({ enableAgentBrowserAccess: true }),
  useUpdatePrimarySettings: () => vi.fn(),
}));

import { BrowserSettingsSection } from "./browser-settings";

describe("Browser settings", () => {
  it("keeps Bot browser access as a plain switch with no status line or hosted provider", () => {
    const markup = renderToStaticMarkup(<BrowserSettingsSection />);
    expect(markup).toContain("Bot browser access");
    expect(markup).not.toContain("Allowed");
    expect(markup).not.toContain("How browser use works");
    expect(markup).not.toContain("Browserbase");
    expect(markup).not.toContain(">Connect</button>");
  });
});
