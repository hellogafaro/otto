import { catalogRegistry } from "@otto/client-runtime/i18n";
import { DEFAULT_UNIFIED_SETTINGS } from "@otto/contracts/settings";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { LanguageProvider } from "../../i18n";

vi.mock("~/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/hooks/use-settings")>()),
  usePrimarySettings: () => DEFAULT_UNIFIED_SETTINGS,
  useUpdatePrimarySettings: () => () => undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: ({ select }: { select: (location: { pathname: string; hash: string }) => string }) =>
    select({ pathname: "/settings/memory", hash: "" }),
  useNavigate: () => () => undefined,
}));

import { BrowserSettingsSection } from "./browser-settings";
import { MemorySettingsPanel } from "./memory-settings";

const zhCNCatalog = await catalogRegistry["zh-CN"]!();

function renderInChinese(children: ReactNode) {
  return renderToStaticMarkup(
    <LanguageProvider testCatalog={{ locale: "zh-CN", catalog: zhCNCatalog }}>
      {children}
    </LanguageProvider>,
  );
}

describe("memory and browser settings in Simplified Chinese", () => {
  it("translates Memory rows", () => {
    const html = renderInChinese(<MemorySettingsPanel />);

    for (const label of ["机器人私有记忆", "保存项目记忆前先询问"]) {
      expect(html).toContain(label);
    }

    for (const label of ["Private bot memory", "Ask before saving project memory"]) {
      expect(html).not.toContain(label);
    }
  });

  it("translates Browser rows and status labels", () => {
    const html = renderInChinese(<BrowserSettingsSection />);

    for (const label of ["需要 API 密钥", "智能体浏览器访问", "浏览器使用方式", "托管会话"]) {
      expect(html).toContain(label);
    }

    for (const label of ["API key required", "Agent browser access", "Hosted sessions"]) {
      expect(html).not.toContain(label);
    }

    // Brand names stay as written.
    expect(html).toContain("Browserbase");
  });
});
