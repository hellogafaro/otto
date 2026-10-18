import { ProviderDriverKind } from "@otto/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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

// Static rendering reads a store's server snapshot, so read the live page's actions directly.
vi.mock("../../page-actions-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../page-actions-registry")>();

  return { ...actual, useActivePageActions: actual.activePageActions };
});

import { registerPageActions } from "../../page-actions-registry";
import type { ComposerProviderCatalog } from "../chat/composer-provider-menu-items";
import { BotPromptCommandMenu, type BotPromptInvite } from "./bot-prompt-command-menu";
import type { BotPromptCommandTrigger } from "./bot-prompt-commands.logic";

function renderMenu(
  trigger: BotPromptCommandTrigger,
  catalog: ComposerProviderCatalog | null = null,
  invite: BotPromptInvite | null = null,
) {
  return renderToStaticMarkup(
    <BotPromptCommandMenu
      ref={null}
      trigger={trigger}
      catalog={catalog}
      invite={invite}
      onSelect={() => {}}
      onRun={() => {}}
      onClose={() => {}}
    />,
  );
}

const slash = (rangeStart: number, query = ""): BotPromptCommandTrigger => ({
  kind: "slash-command",
  query,
  rangeStart,
  rangeEnd: rangeStart + 1 + query.length,
});

const owner = Symbol("test-page");

afterEach(() => registerPageActions(owner, { label: "", actions: [] }));

describe("BotPromptCommandMenu", () => {
  it("says to connect a provider when there is no catalog", () => {
    expect(renderMenu({ kind: "skill", query: "", rangeStart: 0, rangeEnd: 1 })).toContain(
      "Connect a provider to use skills.",
    );

    expect(renderMenu(slash(3))).toContain("Connect a provider to use its commands.");
  });

  it("lists Otto's commands first at the start of a message, then the bot's under their own heading", () => {
    registerPageActions(owner, {
      label: "This chat",
      actions: [
        {
          id: "rename",
          title: "Rename chat",
          searchTerms: [],
          shortcutCommand: "item.rename",
          run: () => {},
        },
        {
          id: "archive",
          title: "Archive chat",
          searchTerms: [],
          shortcutCommand: "item.archive",
          disabled: true,
          run: () => {},
        },
      ],
    });

    const markup = renderMenu(
      slash(0),
      {
        provider: ProviderDriverKind.make("claudeAgent"),
        skills: [],
        slashCommands: [{ name: "compact" }, { name: "model" }],
      },
      { addable: [], add: async () => true },
    );

    const order = ["/invite", "/rename", "/new", "Sent to the bot", "/compact", "/claude:model"];
    expect(order.map((text) => markup.indexOf(text))).toEqual(
      order.map((text) => markup.indexOf(text)).toSorted((a, b) => a - b),
    );
    expect(markup.indexOf("/invite")).toBeGreaterThan(-1);
    // A disabled page action is not offered.
    expect(markup).not.toContain("/archive");
  });

  it("keeps Otto's commands out of a / later in the message", () => {
    const markup = renderMenu(slash(6), {
      provider: ProviderDriverKind.make("codex"),
      skills: [],
      slashCommands: [{ name: "compact" }],
    });

    expect(markup).toContain("/compact");
    expect(markup).not.toContain("/new");
    expect(markup).not.toContain("Sent to the bot");
  });

  it("offers only who can still be added after /invite", () => {
    const invite: BotPromptInvite = {
      addable: [
        {
          kind: "person",
          key: "person:p-2",
          name: "Yara Diaz",
          person: { personId: "p-2", displayName: "Yara Diaz" },
        },
        {
          kind: "person",
          key: "person:p-3",
          name: "Zoe Park",
          person: { personId: "p-3", displayName: "Zoe Park" },
        },
      ],
      add: async () => true,
    };

    const markup = renderMenu(
      { kind: "invite", query: "yar", rangeStart: 0, rangeEnd: 11 },
      null,
      invite,
    );

    expect(markup).toContain("Yara Diaz");
    expect(markup).not.toContain("Zoe Park");
    expect(
      renderMenu({ kind: "invite", query: "", rangeStart: 0, rangeEnd: 9 }, null, {
        addable: [],
        add: async () => true,
      }),
    ).toContain("Everyone is already in this group.");
  });
});
