import type { ResolvedKeybindingsConfig } from "@otto/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@otto/shared/keybindings";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixtures = vi.hoisted(() => {
  const keybindings: ResolvedKeybindingsConfig = [];

  return { keybindings };
});

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) => (atom === "keybindings" ? fixtures.keybindings : null),
}));

vi.mock("../../state/server", () => ({
  primaryServerKeybindingsAtom: "keybindings",
  serverEnvironment: {},
}));

vi.mock("../../state/environments", () => ({
  usePrimaryEnvironment: () => ({ environmentId: "environment-1" }),
}));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

vi.mock("./settings-layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./settings-layout")>()),
  SettingsPageContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { KeybindingsSettingsPanel } from "./keybindings-settings";

function render(): string {
  return renderToStaticMarkup(<KeybindingsSettingsPanel />);
}

describe("KeybindingsSettingsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    fixtures.keybindings = DEFAULT_RESOLVED_KEYBINDINGS;
  });

  it("renders one card per purpose group with collapsed numbered series", () => {
    const html = render();

    for (const title of ["General", "This page", "Chats", "Composer &amp; models", "Layout"]) {
      expect(html).toContain(`>${title}</h2>`);
    }

    expect(html).toContain("Jump to chat 1–9");
    expect(html).toContain("Pick model 1–9");
    expect(html).not.toContain("Jump to chat 4");
    expect(html).toContain("Change shortcut for Open command palette, currently ⌘ K");
    expect(html).toContain("Change shortcut for New, currently C");
    expect(html).not.toContain('type="search"');
    expect(html).not.toContain("Reset to default");
  });

  it("flags conflicts and offers a reset on changed shortcuts", () => {
    fixtures.keybindings = [
      ...DEFAULT_RESOLVED_KEYBINDINGS.filter((binding) => binding.command !== "sidebar.toggle"),
      {
        command: "sidebar.toggle",
        shortcut: {
          key: "k",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
      },
    ];
    const html = render();

    expect(html).toContain("Conflict. Same keys as Toggle sidebar.");
    expect(html).toContain("Reset Toggle sidebar to default");
  });
});
