import { renderToStaticMarkup } from "react-dom/server";
import { presentThreadError } from "@otto/client-runtime/errors";
import { describe, expect, it } from "vite-plus/test";
import { providerCatalogEntry } from "../settings/providerCatalog";

import { errorDetailsBeyond, ThreadErrorCard } from "./ThreadErrorCard";

describe("ThreadErrorCard", () => {
  it("shows the whole error inline, with no disclosure and no dismiss", () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorCard error={"The first error line\ncontinues on a second line"} />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("Dismiss error");
    expect(markup).not.toContain("Full error");
    expect(markup).toContain("The bot couldn’t finish that request");
    expect(markup).toContain(">The first error line<");
    expect(markup).toContain(">continues on a second line<");
  });

  it("keeps the error's whole stack but hides local file paths", () => {
    const error =
      "Cannot connect to API:\n    at run (file:///home/leo/app.ts:1:2)\nCaused by: ECONNREFUSED";

    const markup = renderToStaticMarkup(<ThreadErrorCard error={error} />);

    expect(markup).toContain(">Cannot connect to API<");
    expect(markup).toContain("Caused by: ECONNREFUSED");
    expect(markup).not.toContain("/home/leo");
  });

  it("never repeats the description in the details", () => {
    expect(errorDetailsBeyond("Automatic recovery failed", "Automatic recovery failed")).toBeNull();
    expect(errorDetailsBeyond("Cannot connect", "Cannot connect:\nECONNREFUSED")).toBe(
      "ECONNREFUSED",
    );
    expect(errorDetailsBeyond("Turn ChatGPT on", "Provider instance is disabled")).toBe(
      "Provider instance is disabled",
    );
  });

  it("offers a quiet retry icon for a recoverable failed request", () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorCard error="Automatic recovery failed" onResume={() => {}} />,
    );

    expect(markup).toContain('aria-label="Try again"');
    expect(markup).not.toContain(">Try again<");
  });

  it("turns a disabled provider exception into an actionable message", () => {
    const error =
      "ProviderValidationError: Provider validation failed in AgentController.inspectEngine: Provider instance 'codex' is disabled in Otto settings. at DisabledProviderError (file:///home/leo/app.ts:1:2)";

    expect(presentThreadError(error)).toEqual({
      title: "ChatGPT is turned off",
      description: "Turn ChatGPT on in Settings > Providers, then send your message again.",
      technicalDetails: "Provider instance “codex” is disabled.",
      action: "providers",
      reason: "disabled",
    });

    const markup = renderToStaticMarkup(<ThreadErrorCard error={error} />);

    expect(markup).toContain("ChatGPT is turned off");
    expect(markup).toContain(">Open Providers<");
    expect(markup).not.toContain("AgentController.inspectEngine");
    expect(markup).not.toContain("/home/leo");

    // Signing in won't turn a provider on, so its button just opens the page.
    const withLogo = renderToStaticMarkup(
      <ThreadErrorCard
        error={error}
        context={{ provider: providerCatalogEntry("chatgpt") ?? null }}
      />,
    );

    expect(withLogo).toContain(">Open ChatGPT settings<");
    expect(withLogo).not.toContain("Connect ChatGPT");
  });

  it("uses the server's failure category to name the provider and the fix", () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorCard
        error="Claude authentication failed."
        context={{ unavailability: "expired-login", providerName: "Claude" }}
      />,
    );

    expect(markup).toContain("Claude sign-in expired");
    expect(markup).toContain("Reconnect Claude in Settings &gt; Providers");
    expect(markup).toContain(">Open Providers<");
  });

  it("shows the provider's logo and a button straight to its page", () => {
    const claude = providerCatalogEntry("claude")!;

    const markup = renderToStaticMarkup(
      <ThreadErrorCard
        error="Connect Claude in Settings."
        context={{ unavailability: "missing-login", providerName: "Claude", provider: claude }}
      />,
    );

    expect(markup).toContain("Claude is not connected");
    expect(markup).toContain(">Connect Claude<");
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("Open Providers");
  });
});
