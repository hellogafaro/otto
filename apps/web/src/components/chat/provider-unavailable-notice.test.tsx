import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderUnavailableLine } from "./provider-unavailable-notice";

describe("ProviderUnavailableLine", () => {
  it("renders one quiet line with the provider setup step", () => {
    const markup = renderToStaticMarkup(
      <ProviderUnavailableLine
        id="send-blocked"
        environmentId={null}
        presentation={{
          title: "No provider is ready for this bot",
          description: "Connect a provider in Settings > Models so this bot can reply.",
          action: "providers",
        }}
      />,
    );

    expect(markup).toContain('id="send-blocked"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("No provider is ready for this bot.");
    expect(markup).toContain("Set up a provider");
    expect(markup).not.toContain("Connect a provider in Settings");
    expect(markup).not.toContain("border-warning");
  });

  it("spells out the next step when there is no button to press", () => {
    const markup = renderToStaticMarkup(
      <ProviderUnavailableLine
        environmentId={null}
        presentation={{
          title: "Claude limit reached",
          description: "Wait for it to reset, then send your message again.",
          action: "none",
        }}
      />,
    );

    expect(markup).toContain("Claude limit reached. Wait for it to reset");
    expect(markup).not.toContain("<button");
  });
});
