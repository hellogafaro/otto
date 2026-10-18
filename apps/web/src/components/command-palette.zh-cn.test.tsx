import { catalogRegistry } from "@otto/client-runtime/i18n";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { LanguageProvider } from "../i18n";
import type { CommandPaletteGroup } from "./command-palette.logic";

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));

vi.mock("../state/queries", () => ({
  useThreadSearch: () => ({ matches: [], isPending: false }),
}));

vi.mock("../hooks/use-theme", () => ({
  useTheme: () => ({ resolvedTheme: "dark", setAppearanceMode: () => undefined }),
}));

// Render the dialog shell and results as plain markup so the titles are visible.
vi.mock("./ui/command", () => ({
  CommandDialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  CommandDialogPopup: ({ children, ...props }: { children: ReactNode; "aria-label": string }) => (
    <div aria-label={props["aria-label"]}>{children}</div>
  ),
}));

vi.mock("./command-palette-content", () => ({
  CommandPaletteContent: (props: {
    children: ReactNode;
    footerActionLabel: ReactNode;
    inputProps: { placeholder: string };
  }) => (
    <div>
      <input placeholder={props.inputProps.placeholder} />
      <span>{props.footerActionLabel}</span>
      {props.children}
    </div>
  ),
}));

vi.mock("./command-palette-results", () => ({
  CommandPaletteResults: ({ groups }: { groups: ReadonlyArray<CommandPaletteGroup> }) => (
    <ul>
      {groups.map((group) => (
        <li key={group.value}>
          {group.label}
          {group.items.map((item) => (
            <span key={item.value}>{item.title}</span>
          ))}
        </li>
      ))}
    </ul>
  ),
}));

import { CommandPalette } from "./command-palette";

const zhCNCatalog = await catalogRegistry["zh-CN"]!();

describe("command palette in Simplified Chinese", () => {
  it("translates action titles and chrome", () => {
    const html = renderToStaticMarkup(
      <LanguageProvider testCatalog={{ locale: "zh-CN", catalog: zhCNCatalog }}>
        <CommandPalette>{null}</CommandPalette>
      </LanguageProvider>,
    );

    for (const text of [
      'aria-label="命令面板"',
      'placeholder="搜索聊天、任务、文件等..."',
      "切换到浅色模式",
      "打开自定义",
      "打开用量",
      zhCNCatalog["Open settings"],
      zhCNCatalog["Actions"],
    ]) {
      expect(html).toContain(text);
    }

    expect(html).not.toContain("Open Customize");
    expect(html).not.toContain("切换主题编辑器");
  });
});
