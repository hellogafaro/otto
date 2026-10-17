import type { ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { BotSkillsSection, BotToolsSection } from "./bot-tools-section";

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (children: ReactNode) => children,
}));

vi.stubGlobal("document", { body: null });

const render = (canDelegate?: boolean) =>
  renderToStaticMarkup(
    createElement(BotToolsSection, {
      servers: [],
      accessStatuses: [],
      disabledIds: [],
      onDisabledIdsChange: () => {},
      accounts: [],
      onAccountChange: () => {},
      ...(canDelegate === undefined ? {} : { canDelegate }),
    }),
  );

describe("bot tools delegation note", () => {
  it("explains that a legacy provider cannot hand off work", () => {
    expect(render(false)).toContain("This bot&#x27;s provider cannot hand off work.");
  });

  it("stays quiet for providers that can delegate", () => {
    expect(render(true)).not.toContain("cannot hand off work");
    expect(render()).not.toContain("cannot hand off work");
  });
});

describe("bot skills section", () => {
  it("lists the built-in skills first, always on, under one note", () => {
    const markup = renderToStaticMarkup(
      createElement(BotSkillsSection, {
        environmentId: "env" as never,
        skills: [],
        disabledIds: [],
        onDisabledIdsChange: () => {},
      }),
    );

    expect(markup).toContain("Built-in skills are always on.");
    expect(markup.indexOf(">research<")).toBeGreaterThan(-1);
    expect(markup.indexOf(">research<")).toBeLessThan(markup.indexOf(">computer<"));
    expect(markup).not.toContain("No skills");
    expect(markup.match(/data-disabled/g)?.length ?? 0).toBeGreaterThanOrEqual(11);
  });
});
