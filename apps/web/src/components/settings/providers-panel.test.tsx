import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderApiKeyForm, SUBSCRIPTION_PROVIDERS } from "./providers-panel";

describe("subscription providers", () => {
  it("offers Kimi subscription login without Cursor", () => {
    const providers = SUBSCRIPTION_PROVIDERS.map((provider) => provider.id);
    expect(providers).toContain("kimi-for-coding");
    expect(providers).toContain("opencode-go");
    expect(providers).not.toContain("cursor");
  });

  it("offers OpenCode Go without the standard OpenCode CLI", async () => {
    const { PROVIDER_CATALOG } = await import("./provider-catalog");
    expect(PROVIDER_CATALOG.map((entry) => entry.slug)).toContain("opencode-go");
    expect(PROVIDER_CATALOG.map((entry) => entry.slug)).not.toContain("opencode");
  });

  it("masks API keys and offers an optional endpoint with save and cancel", () => {
    const markup = renderToStaticMarkup(
      <ProviderApiKeyForm
        apiKey=""
        baseUrl=""
        busy={false}
        error="The key was not saved."
        onKeyChange={() => undefined}
        onBaseUrlChange={() => undefined}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain("Base URL (optional)");
    expect(markup).toContain("Save");
    expect(markup).toContain("Cancel");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("The key was not saved.");
    expect(markup).toMatch(/type="submit"[^>]*disabled/);
  });

  it("does not offer a custom endpoint for Grok", () => {
    const markup = renderToStaticMarkup(
      <ProviderApiKeyForm
        supportsBaseUrl={false}
        apiKey=""
        baseUrl=""
        busy={false}
        error={null}
        onKeyChange={() => undefined}
        onBaseUrlChange={() => undefined}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).not.toContain("Base URL");
    expect(markup).toContain("Grok uses its default endpoint.");
    expect(markup).toContain('type="password"');
  });

  it("disables both form actions while saving", () => {
    const markup = renderToStaticMarkup(
      <ProviderApiKeyForm
        apiKey="test-key"
        baseUrl="https://proxy.example"
        busy
        error={null}
        onKeyChange={() => undefined}
        onBaseUrlChange={() => undefined}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).toContain("Saving…");
    expect(markup).toMatch(/type="submit"[^>]*disabled/);
    expect(markup).toMatch(/type="button"[^>]*disabled/);
  });
});
