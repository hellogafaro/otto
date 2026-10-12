import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { ColorSchemeSettings } from "./ThemeSettings";

vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (value: string) => value }) }));

vi.mock("../../hooks/useTheme", () => ({
  useTheme: () => ({ appearanceMode: "system", setAppearanceMode: vi.fn() }),
}));

describe("Color scheme", () => {
  it("renders only System, Light and Dark with the current selection", () => {
    const html = renderToStaticMarkup(createElement(ColorSchemeSettings));
    expect([...html.matchAll(/aria-pressed="(true|false)"/g)].map((match) => match[1])).toEqual([
      "true",
      "false",
      "false",
    ]);

    for (const label of ["System", "Light", "Dark"])
      expect(html).toContain(`aria-label="${label}"`);

    for (const label of ["Classic", "Paper", "Grove", "Iris", "Import", "Customize"]) {
      expect(html).not.toContain(label);
    }
  });
});
