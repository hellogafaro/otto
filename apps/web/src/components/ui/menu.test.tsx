import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Menu, MenuRadioGroup, MenuRadioItem } from "./menu";

describe("menu radio item geometry", () => {
  it("keeps radio-item icons on the same text grid as menu items", () => {
    const html = renderToStaticMarkup(
      <Menu>
        <MenuRadioGroup value="merge">
          <MenuRadioItem value="merge">
            <span className="flex items-center gap-2">
              <svg aria-hidden className="size-3.5" />
              <span>Merge</span>
            </span>
          </MenuRadioItem>
        </MenuRadioGroup>
      </Menu>,
    );

    expect(html).toContain("-mx-0.5");
  });
});

describe("menu letters", () => {
  it("marks an action row with its letter so the open menu can run it", async () => {
    const { MenuLetter } = await import("./menu");
    const html = renderToStaticMarkup(<MenuLetter letter="r" />);

    expect(html).toContain('data-menu-letter="r"');
    expect(html).toContain(">R<");
  });
});
