import { catalogRegistry } from "@otto/client-runtime/i18n";
import { BotId, EnvironmentId, ProviderInstanceId } from "@otto/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { LanguageProvider } from "../../i18n";

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (children: ReactNode) => children,
}));

// Dialogs and sheets mount their popups after hydration, so render them inline when open.
vi.mock("../ui/dialog", async (importOriginal) => {
  const Pass = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;

  return {
    ...(await importOriginal<typeof import("../ui/dialog")>()),
    Dialog: ({ open, children }: { readonly open: boolean; readonly children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogPanel: Pass,
    DialogPopup: Pass,
    DialogTitle: Pass,
  };
});

vi.mock("../ui/sheet", async (importOriginal) => {
  const Pass = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;

  return {
    ...(await importOriginal<typeof import("../ui/sheet")>()),
    Sheet: ({ open, children }: { readonly open: boolean; readonly children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    SheetDescription: Pass,
    SheetFooter: Pass,
    SheetHeader: Pass,
    SheetPanel: Pass,
    SheetPopup: Pass,
    SheetTitle: Pass,
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { readonly children?: ReactNode }) => <a>{children}</a>,
}));

import { BotDetailsPanel } from "./BotDetailsPanel";
import { BotMemorySheet } from "./BotMemorySheet";
import { RosterPanelHeader } from "./BotRosterSidebar";
import { BotStepMeter } from "./BotStepMeter";
import { BotToolsSection } from "./BotToolsSection";
import { BotUsageSection } from "./BotUsageSection";
import { GroupDetailsPanel } from "./GroupDetailsPanel";
import { NewBotDialog } from "./NewBotDialog";
import { NewGroupDialog } from "./NewGroupDialog";
import type { Bot, Group } from "./types";

// The shipped catalog, loaded the same way the language selector loads it.
const zhCNCatalog = await catalogRegistry["zh-CN"]!();

function renderInChinese(children: ReactNode) {
  return renderToStaticMarkup(
    <LanguageProvider testCatalog={{ locale: "zh-CN", catalog: zhCNCatalog }}>
      {children}
    </LanguageProvider>,
  );
}

function makeBot(id: string, name: string): Bot {
  return {
    id,
    name,
    title: "Generalist",
    label: null,
    description: null,
    disabledMcpServerIds: [],
    avatar: { kind: "blob", shape: "circle", color: "#5B7FD4" },
    engine: null,
    sandbox: null,
    runtimeMode: "full-access",
    voiceEnabled: false,
    groupId: null,
    pinned: false,
    archivedAt: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}

const otto = makeBot("bot-otto", "Otto");

const mori = makeBot("bot-mori", "Mori");

describe("roster in Simplified Chinese", () => {
  it("translates the bot details panel", () => {
    const markup = renderInChinese(<BotDetailsPanel bot={otto} />);
    expect(markup).toContain("打开 Otto 机器人侧边栏");
    expect(markup).toContain("收起 Otto 机器人侧边栏");
    expect(markup).toContain("没有可用的提供商");
    expect(markup).not.toContain("No provider ready");
    expect(markup).not.toContain("Open bot settings");
  });

  it("translates the group details panel", () => {
    const group: Group = {
      id: "group-1",
      name: "Research",
      bossBotId: otto.id,
      members: [
        { kind: "bot", botId: BotId.make(otto.id), role: "boss" },
        { kind: "bot", botId: BotId.make(mori.id), role: "specialist" },
      ],
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };

    const markup = renderInChinese(
      <GroupDetailsPanel
        environmentId={EnvironmentId.make("environment-1")}
        group={group}
        bots={[otto, mori]}
        onDeleted={() => {}}
      />,
    );

    expect(markup).toContain("删除群组");
    expect(markup).not.toContain("Delete group");
    expect(markup).not.toContain("Collapse");
  });

  it("translates the step meter", () => {
    const markup = renderInChinese(
      <BotStepMeter
        meter={{
          engine: { provider: ProviderInstanceId.make("codex"), model: "gpt-5" },
          tokens: 1200,
          costUsd: null,
        }}
      />,
    );

    expect(markup).toContain("codex/gpt-5");
    expect(markup).toContain("个令牌");
    expect(markup).not.toContain("tokens");
  });

  it("translates the usage section", () => {
    const markup = renderInChinese(<BotUsageSection environmentId={null} botId="bot-otto" />);
    expect(markup).not.toContain("Bot usage");
    expect(markup).not.toContain("No usage");
    expect(markup).not.toContain("Loading");
  });

  it("translates the tools section", () => {
    const empty = renderInChinese(
      <BotToolsSection
        servers={[]}
        accessStatuses={[]}
        disabledIds={[]}
        onDisabledIdsChange={() => {}}
        canDelegate={false}
      />,
    );

    expect(empty).toContain("工具");
    expect(empty).toContain("自定义");
    expect(empty).toContain("还没有工具");
    expect(empty).toContain("此机器人的提供商无法移交工作。");
    expect(empty).not.toContain("Customize");
    expect(empty).not.toContain("No tools yet");
    expect(empty).not.toContain("cannot hand off work");
  });

  it("translates the memory sheet empty state", () => {
    const markup = renderInChinese(
      <BotMemorySheet open onOpenChange={() => {}} threadRef={null} />,
    );

    expect(markup).toContain("记忆");
    expect(markup).toContain("还没有记忆");
    expect(markup).toContain("与这个机器人开始聊天");
    expect(markup).not.toContain("No memory yet");
    expect(markup).not.toContain("What this bot remembers");
  });

  it("translates the new bot dialog", () => {
    const markup = renderInChinese(
      <NewBotDialog open onOpenChange={() => {}} onCreate={() => {}} />,
    );

    expect(markup).toContain("新建机器人");
    expect(markup).toContain("更换头像");
    expect(markup).toContain("机器人名称");
    expect(markup).toContain("为你的机器人命名");
    expect(markup).toContain("它会先做自我介绍");
    expect(markup).toContain("创建机器人");
    expect(markup).not.toContain("Name your bot");
  });

  it("translates the new group dialog", () => {
    const markup = renderInChinese(
      <NewGroupDialog
        open
        bots={[]}
        people={[
          { personId: "user-me", displayName: "Me" },
          { personId: "user-ana", displayName: "Ana" },
        ]}
        currentPersonId="user-me"
        onOpenChange={() => {}}
        onCreate={() => {}}
      />,
    );

    expect(markup).toContain("新建群组");
    expect(markup).toContain("选择此群组的成员。每个机器人都会收到每条消息。");
    expect(markup).toContain("请至少选择一个机器人。");
    expect(markup).toContain("成员");
    expect(markup).toContain("Ana");
    expect(markup).not.toContain("Choose who is in");
    expect(markup).not.toContain("Select at least one bot.");
  });

  it("translates the roster panel header", () => {
    const markup = renderInChinese(
      <RosterPanelHeader onNewBot={() => {}} onNewGroup={() => {}} onSearch={() => {}} />,
    );

    expect(markup).toContain('aria-label="搜索"');
    expect(markup).toContain('aria-label="新建"');
    expect(markup).not.toContain('aria-label="Search"');
    expect(markup).not.toContain('aria-label="Create"');
  });
});
