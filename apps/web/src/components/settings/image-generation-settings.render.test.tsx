import type {
  ImageGenerationSettings,
  ImageProviderHealth,
  ImageProviderStatus,
} from "@otto/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../state/server", () => ({ serverEnvironment: {} }));

vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => ({}) }));

vi.mock("../../hooks/use-settings", () => ({
  useEnvironmentSettings: vi.fn(),
  useUpdateEnvironmentSettings: () => vi.fn(),
}));

vi.mock("../../settings-dialog-store", () => ({
  openSettings: vi.fn(),
  useSettingsEnvironmentId: () => "environment-1",
}));

import { ImageDefaultProviderRow, ImageProviderRow } from "./image-generation-settings";

function status(
  health: ImageProviderHealth,
  overrides: Partial<ImageProviderStatus> = {},
): ImageProviderStatus {
  return {
    provider: "grok",
    label: "Grok",
    connected: true,
    enabled: true,
    health,
    operations: ["generate"],
    ...overrides,
  };
}

function renderRow(
  row: ImageProviderStatus | undefined,
  enabled = true,
  loadFailed = false,
): string {
  return renderToStaticMarkup(
    <ImageProviderRow
      provider="grok"
      status={row}
      enabled={enabled}
      loadFailed={loadFailed}
      onToggle={() => {}}
      onConnect={() => {}}
    />,
  );
}

describe("image provider row", () => {
  it("shows a working connection with only its switch", () => {
    const markup = renderRow(status("detected"));
    expect(markup).toContain("Uses your Grok connection");
    expect(markup).not.toContain("Not tested");
    expect(markup).not.toContain(">Connect<");
    expect(markup).toContain('aria-label="Use Grok for images"');
  });

  it("badges a failing connection and offers sign-in for revoked access", () => {
    const markup = renderRow(status("revoked"));
    expect(markup).toContain("Revoked");
    expect(markup).toContain("Sign in again");
  });

  it("offers Connect and blocks enabling when no subscription is connected", () => {
    const markup = renderRow(status("missing", { connected: false }), false);
    expect(markup).toContain("Connect Grok in Models first");
    expect(markup).toContain(">Connect<");
    expect(markup).not.toContain("Not connected");
    expect(markup).toMatch(
      /aria-label="Use Grok for images"[^>]*data-disabled|data-disabled[^>]*aria-label="Use Grok for images"/,
    );
  });

  it("shows checking while status loads and unavailable when it failed", () => {
    expect(renderRow(undefined)).toContain("Checking…");
    expect(renderRow(undefined, true, true)).toContain("Status unavailable");
  });
});

describe("default image provider row", () => {
  const both: ImageGenerationSettings = {
    chatgptEnabled: true,
    grokEnabled: true,
    defaultProvider: "grok",
    fallbackOrder: ["grok", "chatgpt"],
  };

  it("shows the current default", () => {
    const markup = renderToStaticMarkup(
      <ImageDefaultProviderRow settings={both} onChange={() => {}} />,
    );

    expect(markup).toContain("Default provider");
    expect(markup).toContain("Grok");
  });
});
