import type { TestProps, TestValue } from "../test-support/react-tree";
import { decodeServerProvider } from "../test-support/fixtures";
import { Predicate } from "effect";
import { isValidElement, type ReactElement } from "react";
import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@otto/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../test-support/react-tree";
import { reactHookHarness as hooks } from "../../test/react-hook-harness";
import type { Bot } from "./types";

const atoms = vi.hoisted(() => ({
  providers: Symbol("providers"),
  mcpServers: Symbol("mcpServers"),
  update: Symbol("botUpdate"),
}));

const state = vi.hoisted(() => ({
  bots: [] as Bot[],
  providers: [] as ServerProvider[],
  updateBot: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/react-hook-harness");

  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: () => {},
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/react-hook-harness");

  return { c: reactHookHarness.useMemoCache };
});

vi.mock("@tanstack/react-router", () => ({
  useBlocker: () => {},
  useCanGoBack: () => false,
  useNavigate: () => vi.fn(),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: symbol) => (atom === atoms.providers ? state.providers : []),
}));

vi.mock("../../state/server", () => ({
  primaryServerProvidersAtom: atoms.providers,
  serverEnvironment: {
    imageProviders: () => Symbol("imageProviders"),
    subscriptionAuth: () => Symbol("subscriptionAuth"),
  },
}));

vi.mock("../../state/mcp-servers", () => ({ environmentMcpServersAtom: () => atoms.mcpServers }));

vi.mock("../../state/bots", () => ({ botEnvironment: { update: atoms.update } }));

vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("environment-1"),
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (atom: symbol) => (atom === atoms.update ? state.updateBot : vi.fn()),
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: true, refresh: vi.fn() }),
}));

vi.mock("../../hooks/use-settings", () => ({
  usePrimarySettings: () => DEFAULT_UNIFIED_SETTINGS,
  useEnvironmentSettings: <T,>(
    _environmentId: EnvironmentId,
    selector: (settings: typeof DEFAULT_UNIFIED_SETTINGS) => T,
  ) => selector(DEFAULT_UNIFIED_SETTINGS),
}));

vi.mock("./roster-store", () => ({
  useRosterStore: <T,>(selector: (store: { bots: Bot[] }) => T) => selector({ bots: state.bots }),
}));

vi.mock("./use-bot-thread-ref", () => ({ useLatestBotChatRef: () => null }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("../../i18n", async () => {
  const { catalogRegistry, createTranslator } = await import("@otto/client-runtime/i18n");
  const translator = createTranslator("zh-CN", await catalogRegistry["zh-CN"]!());

  return { useI18n: () => translator };
});

import { BotSettingsPage } from "./bot-settings-page";
import { expandBotSettingsSections } from "./bot-settings-page.test-support";

const codexId = ProviderInstanceId.make("codex");

function codexProvider(): ServerProvider {
  return decodeServerProvider({
    instanceId: codexId,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-01T00:00:00.000Z",
    models: [
      { slug: "gpt-5", name: "GPT-5", isCustom: false, capabilities: null },
      { slug: "gpt-5-mini", name: "GPT-5 mini", isCustom: false, capabilities: null },
    ],
    slashCommands: [],
    skills: [],
  });
}

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    name: "Scout",
    title: "Scout",
    label: null,
    description: null,
    disabledMcpServerIds: [],
    avatar: { kind: "blob", shape: "circle", color: "#2E8EFF" },
    engine: { provider: codexId, model: "gpt-5" },
    sandbox: "local",
    runtimeMode: "full-access",
    instructions: null,
    voiceEnabled: false,
    imageProvider: null,
    sandboxSize: null,
    groupId: null,
    pinned: false,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

type Tree = ReactElement<TestProps>;

/** Renders the page, then the form it mounts, the way React would on each pass. */
function renderForm(): Tree {
  hooks.beginRender();
  const page = BotSettingsPage({ botId: "bot-1" }) as Tree;

  const formElement = visitElements(
    page,
    (element) => Predicate.isFunction(element.props.onSave) && "bot" in element.props,
  );

  expect(formElement).not.toBeNull();
  const Form = formElement!.type as (props: TestProps) => Tree;

  return expandBotSettingsSections(Form(formElement!.props));
}

function textOf(node: TestValue): string {
  if (Predicate.isString(node) || Predicate.isNumber(node)) return String(node);

  if (Array.isArray(node)) return node.map(textOf).join("");

  if (isValidElement<Tree["props"]>(node)) {
    return textOf((node as Tree).props.children);
  }

  return "";
}

describe("bot settings in Simplified Chinese", () => {
  beforeEach(() => {
    hooks.reset();
    state.bots = [makeBot()];
    state.providers = [codexProvider()];
  });

  it("translates the section titles", () => {
    const form = renderForm();
    expect(textOf(form)).toContain("设置这个机器人与你协作的方式。");

    const titles: unknown[] = [];
    visitElements(form, (element) => {
      if ("id" in element.props && Predicate.isString(element.props.title)) {
        titles.push(element.props.title);
      }

      return false;
    });
    expect(titles).toEqual(
      expect.arrayContaining(["身份", "行为", "指令", "模型与用量", "工作区"]),
    );
    expect(titles).not.toContain("Identity");
  });
});
