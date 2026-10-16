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

    expect(html).toContain("机器人会跨聊天记住事实。");
    expect(html).not.toContain("Bots remember facts across chats.");
  });

  it("translates Browser rows", () => {
    const html = renderInChinese(<BrowserSettingsSection />);

    expect(html).toContain(zhCNCatalog["Bot browser access"]!);
    expect(html).not.toContain("Bot browser access");
  });
});
