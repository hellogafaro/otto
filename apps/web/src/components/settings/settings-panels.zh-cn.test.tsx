import { catalogRegistry } from "@otto/client-runtime/i18n";
import { EnvironmentId } from "@otto/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@otto/contracts/settings";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { LanguageProvider } from "../../i18n";

const environment = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => children,
  useLocation: ({ select }: { select: (location: { pathname: string; hash: string }) => string }) =>
    select({ pathname: "/settings/appearance", hash: "" }),
  useNavigate: () => () => undefined,
}));

// Every atom read resolves to "no server data yet".
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => undefined }));

vi.mock("../../hooks/use-settings", async (importOriginal) => {
  const select = <T,>(selector?: (settings: typeof DEFAULT_UNIFIED_SETTINGS) => T) =>
    selector ? selector(DEFAULT_UNIFIED_SETTINGS) : DEFAULT_UNIFIED_SETTINGS;

  return {
    ...(await importOriginal<typeof import("../../hooks/use-settings")>()),
    usePrimarySettings: select,
    useEnvironmentSettings: (_environmentId: string | null, selector?: never) => select(selector),
    useUpdatePrimarySettings: () => () => undefined,
    useUpdateEnvironmentSettings: () => () => undefined,
  };
});

vi.mock("../../settings-dialog-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../settings-dialog-store")>()),
  useSettingsEnvironmentId: () => environment.id,
}));

vi.mock("../../state/environments", () => ({
  useEnvironment: () => null,
  usePrimaryEnvironment: () => null,
  usePrimaryEnvironmentId: () => null,
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: undefined,
    error: null,
    isPending: false,
    refresh: () => undefined,
  }),
}));

vi.mock("../../state/entities", () => ({ useServerConfigs: () => new Map() }));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => () => undefined }));

vi.mock("../chat/provider-model-picker", () => ({ ProviderModelPicker: () => null }));

vi.mock("../chat/traits-picker", () => ({ TraitsPicker: () => null }));

import { SandboxSettingsPanel } from "./sandbox-settings-panel";
import { AppearanceSettingsPanel } from "./settings-panels";

const zhCNCatalog = await catalogRegistry["zh-CN"]!();

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

function renderInChinese(children: ReactNode) {
  return renderToStaticMarkup(
    <LanguageProvider testCatalog={{ locale: "zh-CN", catalog: zhCNCatalog }}>
      {children}
    </LanguageProvider>,
  );
}

function expectTranslated(
  html: string,
  chinese: ReadonlyArray<string>,
  english: ReadonlyArray<string>,
) {
  for (const label of chinese) expect(html).toContain(label);

  for (const label of english) expect(html).not.toContain(label);
}

describe("settings panels in Simplified Chinese", () => {
  beforeEach(() => {
    environment.id = null;
  });

  it("translates the Appearance panel", () => {
    expectTranslated(
      renderInChinese(<AppearanceSettingsPanel />),
      [zhCNCatalog["Appearance"]!, zhCNCatalog["Interface font size"]!],
      [
        ">Appearance<",
        "Glass opacity",
        "Interface font size",
        "Reset to default",
        zhCNCatalog["Glass opacity"]!,
      ],
    );
  });

  it("translates the Sandbox panel without an environment", () => {
    expectTranslated(
      renderInChinese(<SandboxSettingsPanel />),
      [zhCNCatalog["Sandboxes"]!, zhCNCatalog["Connect to an environment first."]!],
      [">Sandboxes<", "Connect to an environment first."],
    );
  });

  it("translates the Sandboxes card", () => {
    environment.id = ENVIRONMENT_ID;
    expectTranslated(
      renderInChinese(<SandboxSettingsPanel />),
      ["0 个沙盒", zhCNCatalog["Bots run on this computer until you add a sandbox."]!],
      ["0 sandboxes", "Bots run on this computer until you add a sandbox.", ">Connect<"],
    );
  });
});
