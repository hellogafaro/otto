import type { TestProps, TestValue } from "../test-support/react-tree";
import type { ReactElement } from "react";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ImageGenerationSettings,
  type ImageProviderStatus,
  type UnifiedSettings,
} from "@otto/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../test-support/react-tree";
import { reactHookHarness as hooks } from "../../test/react-hook-harness";

const query = vi.hoisted(() => ({
  lastAtom: null as { imageProviders: { environmentId: EnvironmentId; input: {} } } | null,
  providers: null as ReadonlyArray<ImageProviderStatus> | null,
  error: null as string | null,
  isPending: false,
  refresh: vi.fn(),
}));

const settingsState = vi.hoisted(() => ({
  imageGeneration: null as ImageGenerationSettings | null,
  updateSettings: vi.fn(),
}));

const navigation = vi.hoisted(() => ({ openSettings: vi.fn() }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/react-hook-harness");

  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/react-hook-harness");

  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../../state/server", () => ({
  serverEnvironment: {
    imageProviders: <T,>(args: T) => ({ imageProviders: args }),
  },
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: NonNullable<typeof query.lastAtom>) => {
    query.lastAtom = atom;

    return {
      data: query.providers ? { providers: query.providers } : null,
      error: query.error,
      isPending: query.isPending,
      refresh: query.refresh,
    };
  },
}));

vi.mock("../../hooks/use-settings", () => ({
  useEnvironmentSettings: <T,>(
    _environmentId: EnvironmentId,
    selector: (settings: UnifiedSettings) => T,
  ) =>
    selector({
      ...DEFAULT_SERVER_SETTINGS,
      imageGeneration: settingsState.imageGeneration ?? DEFAULT_SERVER_SETTINGS.imageGeneration,
    } as UnifiedSettings),
  useUpdateEnvironmentSettings: () => settingsState.updateSettings,
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (message: string, params: Record<string, string> = {}) =>
      message.replace(/{(w+)}/g, (_, name: string) => params[name] ?? ""),
  }),
}));

vi.mock("../../settings-dialog-store", () => ({
  openSettings: navigation.openSettings,
  useSettingsEnvironmentId: () => null,
}));

import {
  ImageDefaultProviderRow,
  ImageGenerationSettingsContent,
  ImageProviderRow,
} from "./image-generation-settings";
import { SettingsMessageRow } from "./settings-detail-layout";

const environmentId = EnvironmentId.make("remote-device");

function providerStatus(
  provider: ImageProviderStatus["provider"],
  overrides: Partial<ImageProviderStatus> = {},
): ImageProviderStatus {
  return {
    provider,
    label: provider === "chatgpt" ? "ChatGPT" : "Grok",
    connected: true,
    enabled: true,
    health: "detected",
    operations: ["generate"],
    ...overrides,
  };
}

function renderContent(): ReactElement<TestProps> {
  hooks.beginRender();

  return ImageGenerationSettingsContent({ environmentId }) as ReactElement<TestProps>;
}

function findRow(tree: TestValue, provider: ImageProviderStatus["provider"]) {
  const row = visitElements(
    tree,
    (element) => element.type === ImageProviderRow && element.props.provider === provider,
  );

  expect(row).not.toBeNull();

  return row!.props as {
    readonly status: ImageProviderStatus | undefined;
    readonly loadFailed: boolean;
    readonly onToggle: (enabled: boolean) => void;
    readonly onConnect: () => void;
  };
}

function findErrorRow(tree: TestValue) {
  return visitElements(
    tree,
    (element) => element.type === SettingsMessageRow && element.props.tone === "error",
  );
}

describe("ImageGenerationSettingsContent environment wiring", () => {
  beforeEach(() => {
    hooks.reset();
    query.lastAtom = null;
    query.providers = [providerStatus("chatgpt"), providerStatus("grok")];
    query.error = null;
    query.isPending = false;
    query.refresh.mockReset();
    settingsState.imageGeneration = {
      chatgptEnabled: true,
      grokEnabled: false,
      defaultProvider: "chatgpt",
      fallbackOrder: ["chatgpt"],
    };
    settingsState.updateSettings.mockReset();
    navigation.openSettings.mockReset();
  });

  it("lists image providers for the selected environment", () => {
    const tree = renderContent();
    expect(query.lastAtom).toEqual({ imageProviders: { environmentId, input: {} } });
    expect(findRow(tree, "grok").status?.provider).toBe("grok");
  });

  it("persists a provider toggle as an image generation settings patch", () => {
    findRow(renderContent(), "grok").onToggle(true);
    expect(settingsState.updateSettings).toHaveBeenCalledWith({
      imageGeneration: { grokEnabled: true, fallbackOrder: ["chatgpt", "grok"] },
    });
  });

  it("shows the default only with both providers on and saves it with its fallback", () => {
    expect(
      visitElements(renderContent(), (element) => element.type === ImageDefaultProviderRow),
    ).toBeNull();

    settingsState.imageGeneration = {
      chatgptEnabled: true,
      grokEnabled: true,
      defaultProvider: "chatgpt",
      fallbackOrder: ["chatgpt", "grok"],
    };

    const row = visitElements(
      renderContent(),
      (element) => element.type === ImageDefaultProviderRow,
    );

    (row!.props.onChange as (patch: Partial<ImageGenerationSettings>) => void)({
      defaultProvider: "grok",
      fallbackOrder: ["grok", "chatgpt"],
    });
    expect(settingsState.updateSettings).toHaveBeenCalledWith({
      imageGeneration: { defaultProvider: "grok", fallbackOrder: ["grok", "chatgpt"] },
    });
  });

  it("opens the provider connection on Models in the same environment", () => {
    findRow(renderContent(), "grok").onConnect();
    expect(navigation.openSettings).toHaveBeenCalledWith(
      "models",
      "subscription-provider-xai",
      environmentId,
    );
    findRow(renderContent(), "chatgpt").onConnect();
    expect(navigation.openSettings).toHaveBeenLastCalledWith(
      "models",
      "subscription-provider-openai-codex",
      environmentId,
    );
  });

  it("marks rows as loading while provider status is pending", () => {
    query.providers = null;
    query.isPending = true;
    const tree = renderContent();
    const row = findRow(tree, "grok");
    expect(row.status).toBeUndefined();
    expect(row.loadFailed).toBe(false);
    expect(findErrorRow(tree)).toBeNull();
  });

  it("reports a load failure and retries the provider query", () => {
    query.providers = null;
    query.error = "Connection lost";
    const tree = renderContent();
    expect(findRow(tree, "grok").loadFailed).toBe(true);

    const action = findErrorRow(tree)!.props.action as ReactElement<TestProps>;
    (action.props.onClick as () => void)();
    expect(query.refresh).toHaveBeenCalledTimes(1);
  });
});
