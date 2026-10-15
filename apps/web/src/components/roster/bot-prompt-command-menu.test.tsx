import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../i18n", async () => {
  const { createTranslator } = await import("@otto/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useI18n: () => ({ ...translator, t: translator.translate }) };
});

vi.mock("../../hooks/use-settings", () => ({
  usePrimarySettings: <T,>(select: (settings: { showSkillsInSlashMenu: boolean }) => T) =>
    select({ showSkillsInSlashMenu: true }),
}));

vi.mock("../../hooks/use-theme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));

import { BotPromptCommandMenu } from "./bot-prompt-command-menu";

function renderMenu(kind: "skill" | "slash-command") {
  return renderToStaticMarkup(
    <BotPromptCommandMenu
      ref={null}
      trigger={{ kind, query: "", rangeStart: 0, rangeEnd: 1 }}
      catalog={null}
      onSelect={() => {}}
      onClose={() => {}}
    />,
  );
}

describe("BotPromptCommandMenu", () => {
  it("says to connect a provider when there is no catalog", () => {
    expect(renderMenu("skill")).toContain("Connect a provider to use skills.");
    expect(renderMenu("slash-command")).toContain("Connect a provider to use its commands.");
  });
});
