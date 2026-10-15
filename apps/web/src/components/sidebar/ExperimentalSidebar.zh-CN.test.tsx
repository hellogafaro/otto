import { catalogRegistry } from "@otto/client-runtime/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { LanguageProvider } from "../../i18n";

vi.mock("@tanstack/react-router", () => ({
  useLocation: ({ select }: { select: (location: { pathname: string }) => string }) =>
    select({ pathname: "/settings/general" }),
  useNavigate: () => () => undefined,
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));

vi.mock("../../hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useSettings")>()),
  useClientSettings: () => "locale",
}));

vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => null }));

vi.mock("../../state/shell", () => ({ environmentSnapshotAtom: () => null }));

vi.mock("../roster/BotRosterSidebar", () => ({ default: () => null }));

vi.mock("../settings/SettingsSidebarNav", () => ({ SettingsPanelNav: () => null }));

vi.mock("../ui/sidebar", () => ({
  useSidebar: () => ({ state: "expanded", setOpen: () => undefined }),
}));

import { ExperimentalSidebar } from "./ExperimentalSidebar";

const zhCNCatalog = await catalogRegistry["zh-CN"]!();

describe("experimental sidebar in Simplified Chinese", () => {
  it("translates the rail and the settings panel header", () => {
    const html = renderToStaticMarkup(
      <LanguageProvider testCatalog={{ locale: "zh-CN", catalog: zhCNCatalog }}>
        <ExperimentalSidebar />
      </LanguageProvider>,
    );

    for (const label of ["主导航", "聊天", "例行任务", "任务", "项目", "资料库", "设置"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }

    expect(html).toContain(">设置</h2>");
    expect(html).not.toContain("Switch to dark mode");
    expect(html).not.toContain('aria-label="切换到深色模式"');
    expect(html).not.toContain('aria-label="切换到浅色模式"');
    expect(html).not.toContain('aria-label="反馈"');
    expect(html).not.toContain('aria-label="用量"');
    expect(html.match(/class="remixicon/g)).toHaveLength(6);
  });
});
