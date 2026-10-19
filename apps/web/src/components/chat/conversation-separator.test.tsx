import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ConversationSeparator } from "./conversation-separator";

describe("ConversationSeparator", () => {
  it("keeps the day divider on the secondary wave and muted label", () => {
    const markup = renderToStaticMarkup(<ConversationSeparator label="Today" />);

    expect(markup).toContain('data-variant="secondary"');
    expect(markup).toContain('role="separator"');
    expect(markup).toContain('aria-label="Today"');
    expect(markup).toContain("Today");
    expect(markup).toContain("wavy-rule");
    expect(markup).toContain("text-border");
    expect(markup).toContain("text-muted-foreground/70");
    expect(markup).not.toContain("text-primary");
  });

  it("paints the same wave and the label in the primary accent", () => {
    const markup = renderToStaticMarkup(<ConversationSeparator label="New" variant="primary" />);

    expect(markup).toContain('data-variant="primary"');
    expect(markup).toContain('aria-label="New"');
    expect(markup).toContain("New");
    expect(markup).toContain("wavy-rule");
    expect(markup).toContain("text-primary");
    expect(markup).not.toContain("text-border");
    expect(markup).not.toContain("text-muted-foreground/70");
    expect(markup.match(/wavy-rule/g)).toHaveLength(2);
    expect(markup.match(/text-primary/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
