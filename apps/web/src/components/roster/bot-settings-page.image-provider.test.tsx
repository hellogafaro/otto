import type { TestProps, TestValue } from "../test-support/react-tree";
import { decodeServerProvider } from "../test-support/fixtures";
import { Predicate } from "effect";
import { isValidElement, type ReactElement } from "react";
import {
  BOT_INSTRUCTIONS_MAX_CHARS,
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ImageGenerationSettings,
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
  imageGeneration: null as ImageGenerationSettings | null,
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
  ) =>
    selector({
      ...DEFAULT_UNIFIED_SETTINGS,
      imageGeneration: state.imageGeneration ?? DEFAULT_UNIFIED_SETTINGS.imageGeneration,
    }),
}));

vi.mock("./roster-store", () => ({
  useRosterStore: <T,>(selector: (store: { bots: Bot[] }) => T) => selector({ bots: state.bots }),
}));

vi.mock("./use-bot-thread-ref", () => ({ useLatestBotChatRef: () => null }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("../../i18n", async () => {
  const { createTranslator } = await import("@otto/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useI18n: () => ({ ...translator, t: translator.translate }) };
});

import { BotSettingsPage } from "./bot-settings-page";
import { expandBotSettingsSections } from "./bot-settings-page.test-support";

const environmentId = EnvironmentId.make("environment-1");

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

function imageSelect(tree: Tree) {
  const select = visitElements(
    tree,
    (element) =>
      Predicate.isFunction(element.props.onValueChange) &&
      visitElements(
        element.props.children,
        (child) => child.props["aria-label"] === "Image provider",
      ) !== null,
  );

  expect(select).not.toBeNull();

  return select!.props as {
    readonly value: string;
    readonly onValueChange: (value: string) => void;
    readonly children: TestValue;
  };
}

function textOf(node: TestValue): string {
  if (Predicate.isString(node) || Predicate.isNumber(node)) return String(node);

  if (Array.isArray(node)) return node.map(textOf).join("");

  if (isValidElement<Tree["props"]>(node)) {
    return textOf((node as Tree).props.children);
  }

  return "";
}

function selectedLabel(tree: Tree): string {
  const trigger = visitElements(
    imageSelect(tree).children,
    (element) => element.props["aria-label"] === "Image provider",
  );

  return textOf(trigger?.props.children);
}

/** Leaving a field saves the profile at once, the way the 800ms autosave would. */
function flushSave(tree: Tree) {
  const form = visitElements(tree, (element) => Predicate.isFunction(element.props.onBlurCapture));

  expect(form).not.toBeNull();
  (form!.props.onBlurCapture as () => void)();
}

function instructionsField(tree: Tree) {
  const field = visitElements(
    tree,
    (element) => element.props["aria-label"] === "Bot instructions",
  );

  expect(field).not.toBeNull();

  return field!.props as {
    readonly value: string;
    readonly maxLength: number;
    readonly onChange: (event: { currentTarget: { value: string } }) => void;
  };
}

function modelPicker(tree: Tree) {
  const picker = visitElements(
    tree,
    (element) =>
      Predicate.isFunction(element.props.onChange) && "activeInstanceId" in element.props,
  );

  expect(picker).not.toBeNull();

  return picker!.props as {
    readonly activeInstanceId: string;
    readonly model: string;
    readonly onChange: (instanceId: string, model: string) => void;
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

function expectedUpdate(bot: Bot, overrides: TestProps) {
  return {
    environmentId,
    input: {
      botId: bot.id,
      name: bot.name,
      label: null,
      description: null,
      engine: bot.engine,
      sandbox: bot.sandbox,
      instructions: null,
      voiceEnabled: false,
      imageProvider: null,
      sandboxSize: null,
      ...overrides,
    },
  };
}

describe("bot settings image provider", () => {
  beforeEach(() => {
    hooks.reset();
    state.bots = [makeBot()];
    state.providers = [codexProvider()];
    state.imageGeneration = {
      chatgptEnabled: true,
      grokEnabled: true,
      defaultProvider: "chatgpt",
      fallbackOrder: ["chatgpt", "grok"],
    };
    state.updateBot.mockReset().mockResolvedValue({ _tag: "Success" });
  });

  it("starts on the global default without unsaved changes", () => {
    const tree = renderForm();
    expect(imageSelect(tree).value).toBe("default");
    expect(selectedLabel(tree)).toBe("Use global default (ChatGPT)");
    flushSave(tree);
    expect(state.updateBot).not.toHaveBeenCalled();
  });

  it("preserves inheritance until Local is explicitly selected", async () => {
    state.bots = [makeBot({ sandbox: null })];
    let tree = renderForm();
    flushSave(tree);
    expect(state.updateBot).not.toHaveBeenCalled();

    const select = visitElements(
      tree,
      (element) =>
        Predicate.isFunction(element.props.onValueChange) &&
        visitElements(
          element.props.children,
          (child) => child.props["aria-label"] === "Sandbox provider",
        ) !== null,
    );

    expect(select?.props.value).toBe("default");
    (select!.props.onValueChange as (value: string) => void)("local");
    tree = renderForm();
    flushSave(tree);
    await flushPromises();
    expect(state.updateBot).toHaveBeenCalledWith(
      expectedUpdate(state.bots[0]!, { sandbox: "local" }),
    );
  });

  it("preserves an inherited sandbox while saving another field", async () => {
    state.bots = [makeBot({ sandbox: null })];
    imageSelect(renderForm()).onValueChange("grok");
    flushSave(renderForm());
    await flushPromises();
    expect(state.updateBot).toHaveBeenCalledWith(
      expectedUpdate(state.bots[0]!, { imageProvider: "grok", sandbox: null }),
    );
  });

  it("can restore the default sandbox from an explicit choice", async () => {
    state.bots = [makeBot({ sandbox: "boat" })];
    const tree = renderForm();

    const select = visitElements(
      tree,
      (element) =>
        Predicate.isFunction(element.props.onValueChange) &&
        visitElements(
          element.props.children,
          (child) => child.props["aria-label"] === "Sandbox provider",
        ) !== null,
    );

    (select!.props.onValueChange as (value: string) => void)("default");
    flushSave(renderForm());
    await flushPromises();
    expect(state.updateBot).toHaveBeenCalledWith(expectedUpdate(state.bots[0]!, { sandbox: null }));
  });

  it("keeps a removed saved provider visible while editing another field", async () => {
    const missingId = ProviderInstanceId.make("removed_claude");
    state.bots = [makeBot({ engine: { provider: missingId, model: "sonnet" } })];

    let tree = renderForm();
    expect(modelPicker(tree).activeInstanceId).toBe(missingId);

    const notice = visitElements(tree, (element) =>
      Boolean(element.props.presentation && Predicate.isObjectOrArray(element.props.presentation)),
    );

    expect(notice?.props.presentation).toMatchObject({ reason: "missing-provider" });

    imageSelect(tree).onValueChange("grok");
    tree = renderForm();
    flushSave(tree);
    await flushPromises();
    expect(state.updateBot).toHaveBeenCalledWith(
      expectedUpdate(state.bots[0]!, { imageProvider: "grok" }),
    );
  });

  it.each([
    ["grok", "Grok"],
    ["chatgpt", "ChatGPT"],
  ] as const)("saves %s as the bot's image provider", async (provider, label) => {
    imageSelect(renderForm()).onValueChange(provider);

    let tree = renderForm();
    expect(imageSelect(tree).value).toBe(provider);
    expect(selectedLabel(tree)).toBe(label);
    flushSave(tree);
    await flushPromises();
    expect(state.updateBot).toHaveBeenCalledTimes(1);
    expect(state.updateBot).toHaveBeenCalledWith(
      expectedUpdate(state.bots[0]!, { imageProvider: provider }),
    );

    // The roster refreshes with the saved bot; the draft now matches it.
    state.bots = [makeBot({ imageProvider: provider })];
    tree = renderForm();
    expect(imageSelect(tree).value).toBe(provider);
    state.updateBot.mockClear();
    flushSave(tree);
    expect(state.updateBot).not.toHaveBeenCalled();
  });

  it("clears a saved provider back to the global default", async () => {
    state.bots = [makeBot({ imageProvider: "grok" })];
    let tree = renderForm();
    expect(imageSelect(tree).value).toBe("grok");

    imageSelect(tree).onValueChange("default");
    tree = renderForm();
    expect(imageSelect(tree).value).toBe("default");
    expect(selectedLabel(tree)).toBe("Use global default (ChatGPT)");

    flushSave(tree);
    await flushPromises();
    expect(state.updateBot).toHaveBeenCalledWith(
      expectedUpdate(state.bots[0]!, { imageProvider: null }),
    );
  });

  it("keeps the image choice and the chat model independent", async () => {
    imageSelect(renderForm()).onValueChange("grok");
    let tree = renderForm();
    expect(modelPicker(tree).model).toBe("gpt-5");

    modelPicker(tree).onChange(codexId, "gpt-5-mini");
    tree = renderForm();
    expect(imageSelect(tree).value).toBe("grok");
    expect(modelPicker(tree).model).toBe("gpt-5-mini");

    imageSelect(tree).onValueChange("chatgpt");
    tree = renderForm();
    expect(modelPicker(tree).model).toBe("gpt-5-mini");

    flushSave(tree);
    await flushPromises();
    expect(state.updateBot).toHaveBeenCalledWith(
      expectedUpdate(state.bots[0]!, {
        engine: { provider: codexId, model: "gpt-5-mini" },
        imageProvider: "chatgpt",
      }),
    );
  });

  it("limits the instructions to the contract maximum", () => {
    expect(instructionsField(renderForm()).maxLength).toBe(BOT_INSTRUCTIONS_MAX_CHARS);
  });

  it("saves typed instructions through bot.update, trimmed", async () => {
    instructionsField(renderForm()).onChange({
      currentTarget: { value: "  Review pull requests.  " },
    });

    const tree = renderForm();
    expect(instructionsField(tree).value).toBe("  Review pull requests.  ");

    flushSave(tree);
    await flushPromises();
    expect(state.updateBot).toHaveBeenCalledTimes(1);
    expect(state.updateBot).toHaveBeenCalledWith(
      expectedUpdate(state.bots[0]!, { instructions: "Review pull requests." }),
    );

    state.bots = [makeBot({ instructions: "Review pull requests." })];
    state.updateBot.mockClear();
    flushSave(renderForm());
    expect(state.updateBot).not.toHaveBeenCalled();
  });

  it("saves empty or whitespace-only instructions as null", async () => {
    state.bots = [makeBot({ instructions: "Be brief." })];
    expect(instructionsField(renderForm()).value).toBe("Be brief.");

    instructionsField(renderForm()).onChange({ currentTarget: { value: " \n  " } });
    flushSave(renderForm());
    await flushPromises();
    expect(state.updateBot).toHaveBeenCalledWith(
      expectedUpdate(state.bots[0]!, { instructions: null }),
    );
  });

  it("changing only the chat model saves the bot's image choice unchanged", async () => {
    state.bots = [makeBot({ imageProvider: "grok" })];
    modelPicker(renderForm()).onChange(codexId, "gpt-5-mini");
    const tree = renderForm();
    expect(imageSelect(tree).value).toBe("grok");

    flushSave(tree);
    await flushPromises();
    expect(state.updateBot).toHaveBeenCalledWith(
      expectedUpdate(state.bots[0]!, {
        engine: { provider: codexId, model: "gpt-5-mini" },
        imageProvider: "grok",
      }),
    );
  });
});
