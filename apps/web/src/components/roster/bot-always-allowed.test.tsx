import type { TestProps } from "../test-support/react-tree";
import { AuthSessionId, EnvironmentId } from "@otto/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../test-support/react-tree";
import { reactHookHarness as hooks } from "../../test/react-hook-harness";
import type { Bot } from "./types";

const state = vi.hoisted(() => ({ updateBot: vi.fn() }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/react-hook-harness");

  return { ...actual, useState: reactHookHarness.useState };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/react-hook-harness");

  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      key.replace(/\{(\w+)\}/g, (_, name: string) => params?.[name] ?? ""),
    formatDate: () => "Oct 17, 2026",
  }),
}));

vi.mock("../../state/bots", () => ({ botEnvironment: { update: Symbol("botUpdate") } }));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.updateBot }));

import { SettingsRow } from "../settings/settings-layout";
import { BotAlwaysAllowed } from "./bot-always-allowed";

const createdBy = { personId: AuthSessionId.make("person-ana"), displayName: "Ana" };

const createdAt = "2026-10-17T10:00:00.000Z";

const shell = { toolName: "shell", action: null, createdBy, createdAt };

const send = { toolName: "gmail_send_message", action: "send", createdBy, createdAt };

function render(alwaysAllowed: Bot["alwaysAllowed"]): ReactElement<TestProps> {
  hooks.beginRender();

  return BotAlwaysAllowed({
    // SAFETY: the section reads only the bot's id and always-allowed tools.
    bot: { id: "bot-ops", alwaysAllowed } as Bot,
    environmentId: EnvironmentId.make("environment-1"),
  }) as ReactElement<TestProps>;
}

const rows = (tree: ReactElement<TestProps>) => {
  const found: TestProps[] = [];
  visitElements(tree, (element) => {
    if (element.type === SettingsRow) found.push(element.props);

    return false;
  });

  return found;
};

describe("BotAlwaysAllowed", () => {
  beforeEach(() => {
    hooks.reset();
    state.updateBot.mockReset();
    state.updateBot.mockResolvedValue({ _tag: "Success" });
  });

  it("says when nothing is always allowed", () => {
    expect(rows(render(undefined)).map((row) => row.title)).toEqual(["Nothing always allowed"]);
  });

  it("names each tool, the kind of action, who turned it on and when", () => {
    expect(rows(render([shell, send])).map((row) => [row.title, row.description])).toEqual([
      ["shell", "Turned on by Ana on Oct 17, 2026"],
      ["gmail_send_message", "Sending only · Turned on by Ana on Oct 17, 2026"],
    ]);
  });

  it("removes one tool and keeps the rest", () => {
    const remove = visitElements(
      render([shell, send]),
      (element) => element.props["aria-label"] === "Stop always allowing gmail_send_message",
    );

    expect(remove).not.toBeNull();
    (remove!.props.onClick as () => void)();

    expect(state.updateBot).toHaveBeenCalledWith({
      environmentId: "environment-1",
      input: { botId: "bot-ops", alwaysAllowed: [shell] },
    });
  });
});
