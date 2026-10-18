import {
  AuthSessionId,
  EnvironmentId,
  type Memory,
  type MemoryListResult,
  ProjectId,
  ThreadId,
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
  },
}));

vi.mock("../../state/query", () => ({ useEnvironmentQuery: controls.query }));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

vi.mock("../../state/entities", () => ({
  useProjects: () => [
    { environmentId: "environment-1", id: "project-general", title: "General" },
    { environmentId: "environment-1", id: "project-lora", title: "Lora Boutique" },
  ],
}));

import { BotMemorySheet, memoryErrorMessage, memoryMeta } from "./bot-memory-sheet";

const lora = ProjectId.make("project-lora");

const props = {
  open: true,
  onOpenChange: vi.fn(),
  environmentId: EnvironmentId.make("environment-1"),
  projectId: lora,
};

const memory = (id: string, text: string, overrides: Partial<Memory> = {}): Memory => ({
  id,
  owner: "team",
  projectId: null,
  text,
  threadId: ThreadId.make("thread-launch"),
  threadTitle: "Launch plan",
  editedBy: null,
  createdAt: "2026-10-16T09:00:00.000Z",
  confirmedAt: "2026-10-16T09:00:00.000Z",
  ...overrides,
});

const loaded = (result: MemoryListResult) => ({ data: result, error: null, isPending: false });

const labels = { allProjects: "All projects", deletedProject: "Deleted project" };

const formatDate = (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(value);

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

  it("shows skeleton rows under Yours and Team while loading", () => {
    controls.query.mockReturnValue({ data: undefined, error: null, isPending: true });
    const markup = renderToStaticMarkup(createElement(BotMemorySheet, props));

    expect(controls.list).toHaveBeenCalledWith({ environmentId: props.environmentId, input: {} });
    expect(markup).toContain('data-slot="skeleton"');
    expect(markup).toContain("Yours");
    expect(markup).toContain("Team");
  });

  it("lists yours and the team's lines with where they apply and where they came from", () => {
    controls.query.mockReturnValue(
      loaded({
        memories: [
          memory("m_one", "Ana prefers short replies.", { owner: "you" }),
          memory("m_two", "Lora invoices are in EUR.", {
            projectId: lora,
            projectTitle: "Lora Boutique",
            threadTitle: null,
            editedBy: AuthSessionId.make("person-ana"),
          }),
          memory("m_three", "Mai runs QA."),
        ],
      }),
    );

    const markup = renderToStaticMarkup(createElement(BotMemorySheet, props));

    expect(markup).toContain("What bots remember.");
    expect(markup).toContain("Learned in your private chats with bots, and used only there.");
    expect(markup).toContain("1 memory");
    expect(markup).toContain("2 memories");
    expect(markup).toContain("Ana prefers short replies.");
    expect(markup).toContain("All projects · Oct 2026 · Launch plan");
    expect(markup).toContain("Lora Boutique · Oct 2026");
    expect(markup).toContain('aria-label="Add to Yours"');
    expect(markup).toContain('aria-label="Add to Team"');
    expect(markup.indexOf("Ana prefers")).toBeLessThan(markup.indexOf("Lora invoices"));
  });

  it("is read-only while Memory is off", () => {
    controls.enabled = false;
    controls.query.mockReturnValue(loaded({ memories: [memory("m_one", "Mai runs QA.")] }));

    const markup = renderToStaticMarkup(createElement(BotMemorySheet, props));

    expect(markup).toContain("Memory is off.");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain('aria-label="Add to Team"');
  });

  it("labels a line by where it applies, the month it was last confirmed and its source chat", () => {
    expect(memoryMeta(memory("m_one", "x"), labels, formatDate)).toBe(
      "All projects · Oct 2026 · Launch plan",
    );

    expect(
      memoryMeta(
        memory("m_one", "x", { projectId: lora, projectTitle: null, threadTitle: null }),
        labels,
        formatDate,
      ),
    ).toBe("Deleted project · Oct 2026");
  });

  it("keeps server failures and falls back for unknown errors", () => {
    expect(memoryErrorMessage(new Error("Keep a memory to 280 characters."))).toBe(
      "Keep a memory to 280 characters.",
    );
    expect(memoryErrorMessage(null)).toBeNull();
  });
});
