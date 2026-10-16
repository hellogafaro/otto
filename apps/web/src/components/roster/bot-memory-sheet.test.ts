import {
  AuthSessionId,
  BotId,
  EnvironmentId,
  type Memory,
  type MemoryListResult,
} from "@otto/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const controls = vi.hoisted(() => ({
  list: vi.fn(() => "memory-list"),
  query: vi.fn(),
  enabled: true,
}));

vi.mock("../ui/sheet", async () => {
  const React = await import("react");

  const Wrapper = ({ children }: { readonly children?: React.ReactNode }) =>
    React.createElement("div", null, children);

  return {
    Sheet: Wrapper,
    SheetDescription: Wrapper,
    SheetFooter: Wrapper,
    SheetHeader: Wrapper,
    SheetPanel: Wrapper,
    SheetPopup: Wrapper,
    SheetTitle: Wrapper,
  };
});

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) =>
    atom === "people"
      ? {
          current: { id: "person-ana", displayName: "Ana" },
          directory: [{ personId: "person-icon", displayName: "Icon" }],
        }
      : [{ id: "bot-juno", name: "Juno" }],
}));

vi.mock("../../state/bots", () => ({
  environmentBotsAtom: () => "bots",
  environmentPeopleAtom: () => "people",
}));

vi.mock("~/hooks/use-settings", () => ({
  usePrimarySettings: (select: (settings: { memory: { enabled: boolean } }) => boolean) =>
    select({ memory: { enabled: controls.enabled } }),
}));

vi.mock("../../state/memory", () => ({
  memoryEnvironment: {
    list: controls.list,
    create: "create",
    update: "update",
    remove: "remove",
    decide: "decide",
  },
}));

vi.mock("../../state/query", () => ({ useEnvironmentQuery: controls.query }));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

import { BotMemorySheet } from "./bot-memory-sheet";

const props = {
  open: true,
  onOpenChange: vi.fn(),
  environmentId: EnvironmentId.make("environment-1"),
  botId: BotId.make("bot-juno"),
  botName: "Juno",
};

const memory = (id: string, text: string, overrides: Partial<Memory> = {}) => ({
  id,
  scope: "person" as const,
  scopeId: "person-ana",
  text,
  status: "active" as const,
  replacesId: null,
  botId: BotId.make("bot-juno"),
  personId: null,
  threadId: null,
  threadTitle: "Launch plan",
  createdAt: "2026-10-16T09:00:00.000Z",
  updatedAt: "2026-10-16T09:00:00.000Z",
  ...overrides,
});

const loaded = (sections: MemoryListResult["sections"]) => ({
  data: { sections },
  error: null,
  isPending: false,
});

const section = (scope: "person" | "bot" | "project", memories: ReturnType<typeof memory>[]) => ({
  scope,
  scopeId: { person: "person-ana", bot: "bot-juno", project: "project-otto" }[scope],
  title: scope === "project" ? "Otto" : "",
  used: memories.reduce((total, row) => total + row.text.length, 0),
  cap: scope === "project" ? 2_000 : 1_500,
  memories,
});

describe("BotMemorySheet", () => {
  beforeEach(() => {
    controls.list.mockClear();
    controls.query.mockReset();
    controls.enabled = true;
  });

  it("does not list memory while closed", () => {
    controls.query.mockReturnValue({ data: undefined, error: null, isPending: true });
    renderToStaticMarkup(createElement(BotMemorySheet, { ...props, open: false }));

    expect(controls.list).not.toHaveBeenCalled();
  });

  it("shows skeleton rows under the real section titles while loading", () => {
    controls.query.mockReturnValue({ data: undefined, error: null, isPending: true });
    const markup = renderToStaticMarkup(createElement(BotMemorySheet, props));

    expect(controls.list).toHaveBeenCalledWith({
      environmentId: props.environmentId,
      input: { botId: props.botId },
    });
    expect(markup).toContain('data-slot="skeleton"');
    expect(markup).toContain("About you");
    expect(markup).toContain("Juno");
  });

  it("shows the empty state when no scope holds anything", () => {
    controls.query.mockReturnValue(loaded([section("person", []), section("bot", [])]));
    const markup = renderToStaticMarkup(createElement(BotMemorySheet, props));

    expect(markup).toContain("No memories yet");
    expect(markup).toContain("Add memory");
  });

  it("lists entries by scope with their writer, pending approvals and a full warning", () => {
    controls.query.mockReturnValue(
      loaded([
        section("person", [memory("m_one", "Likes durian.")]),
        section("bot", []),
        section("project", [
          memory("m_two", "Releases ship on Thursdays.", {
            scope: "project",
            scopeId: "project-otto",
            status: "pending",
          }),
          memory("m_three", "x".repeat(1_800), {
            scope: "project",
            scopeId: "project-otto",
            botId: null,
            personId: AuthSessionId.make("person-icon"),
            threadTitle: null,
          }),
        ]),
      ]),
    );

    const markup = renderToStaticMarkup(createElement(BotMemorySheet, props));

    expect(markup).toContain("Likes durian.");
    expect(markup).toContain("Juno · Launch plan · Oct 16");
    expect(markup).toContain("Icon · Oct 16");
    expect(markup).toContain("Otto");
    expect(markup).toContain("Waiting for approval");
    expect(markup).toContain("Almost full");
    expect(markup).toContain("Deleting a memory does not remove it from past chats.");
  });

  it("is read-only while Memory is off", () => {
    controls.enabled = false;
    controls.query.mockReturnValue(loaded([section("person", [memory("m_one", "Likes durian.")])]));
    const markup = renderToStaticMarkup(createElement(BotMemorySheet, props));

    expect(markup).toContain("Memory is off.");
    expect(markup).not.toContain('aria-label="Memory actions"');
    expect(markup).not.toContain('aria-label="Add to About you"');
  });
});
