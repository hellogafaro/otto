import { RiCheckLine, RiSettings3Line } from "@remixicon/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { iconPath } from "../../test/iconPath";
import { AppIcon } from "./app-icon";

describe("AppIcon", () => {
  it("renders the selected Remix path and keeps its tone and accessible override", () => {
    const markup = renderToStaticMarkup(
      <AppIcon
        icon={RiSettings3Line}
        tone="sidebar-muted"
        className="size-5"
        aria-label="Settings"
        aria-hidden={false}
      />,
    );

    expect(markup).toContain(iconPath(RiSettings3Line));
    expect(markup).toContain("remixicon");
    expect(markup).toContain("text-sidebar-muted-foreground");
    expect(markup).toContain("size-5");
    expect(markup).toContain('aria-label="Settings"');
    expect(markup).toContain('aria-hidden="false"');
    expect(markup).not.toContain("stroke-width");
  });

  it("keeps inline chip sizing and hides decorative icons by default", () => {
    const markup = renderToStaticMarkup(<AppIcon icon={RiCheckLine} fit="inline-chip" />);

    expect(markup).toContain(iconPath(RiCheckLine));
    expect(markup).toContain("size-[1.17em]");
    expect(markup).toContain('aria-hidden="true"');
  });
});
