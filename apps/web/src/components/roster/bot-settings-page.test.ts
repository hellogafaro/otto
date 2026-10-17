import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { readBotSettingsSource } from "./bot-settings-page.test-support";
import {
  BOT_IMAGE_PROVIDER_DEFAULT,
  botImageProviderFromSelectValue,
} from "./use-bot-profile-draft";

function read(relativePath: string): string {
  return NodeFS.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("bot settings page", () => {
  it("is a Settings subpage, and the old link redirects to it", () => {
    const route = read("../../routes/settings.bots.$botId.tsx");
    const legacy = read("../../routes/bots.$botId.settings.tsx");
    const tree = read("../../routeTree.gen.ts");

    expect(route).toContain('createFileRoute("/settings/bots/$botId")');
    expect(route).toContain("<BotSettingsPage");
    expect(route).toContain("Route.useParams().botId");
    expect(legacy).toContain('to: "/settings/bots/$botId"');
    expect(tree).toContain("'/settings/bots/$botId'");
  });

  it("renders in the Settings layout with the shared settings primitives", () => {
    const source = readBotSettingsSource();

    expect(source).toContain("<SettingsPageContainer>");
    expect(source).toContain("<SettingsSection");
    expect(source).toContain("<SettingsRow");
    // A cramped modal is exactly what this page replaces.
    expect(source).not.toContain("<DialogPopup");
    expect(source).not.toContain("<SheetPopup");
  });

  it("groups the bot's own settings into named sections", () => {
    const source = readBotSettingsSource();

    expect(source).toContain('id="identity" title={t("Identity")}');
    expect(source).toContain('id="behavior" title={t("Behavior")}');
    expect(source).toContain('id="model" title={t("Model & usage")}');
    expect(source).toContain('title={t("Workspace")}');
    // Sections stack as titled cards, with no tab strip above them.
    expect(source).not.toContain("<nav");
  });

  it("saves through the shared bot update command", () => {
    const source = readBotSettingsSource();

    expect(source).toContain("useAtomCommand(botEnvironment.update");
    expect(source).toContain("botId: BotId.make(bot.id)");
    // The draft hook builds the payload, so the page cannot invent a shape.
    expect(source).toContain("useBotProfileDraft(bot, onSave)");
    expect(source).toContain('toast.error(t("Bot settings couldn\'t be saved"))');
  });

  it("saves as you go, with no Save bar or unsaved-changes prompt", () => {
    const source = readBotSettingsSource();
    const draft = read("./use-bot-profile-draft.ts");

    expect(source).toContain("onBlurCapture={draft.flush}");
    expect(source).not.toContain("bot-settings-save-bar");
    expect(source).not.toContain("useBlocker");
    expect(draft).toContain("useAutosave(save)");
    expect(draft).toContain("const markChanged = () => autosave.schedule();");
  });

  it("owns the instructions textarea, limits it and autosaves it, with no personality control", () => {
    const source = readBotSettingsSource();

    expect(source).toContain('id="instructions"');
    expect(source).toContain("maxLength={BOT_INSTRUCTIONS_MAX_CHARS}");
    expect(source).toContain("draft.setInstructions(event.currentTarget.value);");
    expect(source).toContain("draft.markChanged();");
    expect(source.toLowerCase()).not.toContain("personality");
  });

  it("lists integrations and skills inline with per-bot switches that autosave", () => {
    const page = readBotSettingsSource();
    const switches = read("./bot-tool-switches.tsx");
    const section = read("./bot-tools-section.tsx");

    expect(page).toContain("<BotToolSwitches");
    expect(switches).toContain("<BotToolsSection");
    expect(switches).toContain("<BotSkillsSection");
    expect(switches).toContain("setPendingMcp(ids);");
    expect(switches).toContain("setPendingSkills(ids);");
    expect(switches).toContain("useAutosave(save)");
    // Tools used to open an overlay sheet; they now live on the page.
    expect(page).not.toContain("BotToolsSheet");
    expect(section).toContain('id="tools"');
    expect(section).toContain("<Switch");
    expect(section).toContain('t("No integrations")');
    expect(section).not.toContain("BotSideSheet");
  });

  it("handles a bot that is gone instead of rendering an empty form", () => {
    const source = readBotSettingsSource();
    expect(source).toContain("This bot is no longer available.");
  });
});

describe("bot settings entry points", () => {
  it("opens from the chat header bot identity", () => {
    const source = read("./active-bot-header-chip.tsx");

    expect(source).toContain('to: "/settings/bots/$botId"');
    expect(source).toContain("params: { botId: bot.id }");
    expect(source).toContain("aria-label={`Settings for ${bot.name}`}");
    // The avatar keeps its existing job.
    expect(source).toContain("aria-label={`Change avatar for ${bot.name}`}");
  });

  it("opens from the roster row overflow menu", () => {
    const source = ["./bot-roster-sidebar.tsx", "./roster-rows.tsx"].map(read).join("\n");

    expect(source).toContain("Bot settings");
    expect(source).toContain("onOpenSettings(bot)");
    expect(source).toContain("const handleOpenBotSettings");
    expect(source).toContain('to: "/settings/bots/$botId"');
    expect(source).toContain("onOpenSettings={handleOpenBotSettings}");
  });

  it("keeps the chat panel about the chat and leaves bot setup to Settings", () => {
    const panel = read("./chat-details-panel.tsx");

    expect(panel).not.toContain('to: "/settings/bots/$botId"');
    expect(panel).toContain('t("Project")');
    expect(panel).toContain('t("Members")');
    expect(panel).not.toContain("<BotModelPicker");
  });

  it("lists bots in Settings, where each opens its own settings page", () => {
    const settingsStore = read("../../settings-dialog-store.ts");
    const botsPage = read("../settings/bots-settings.tsx");

    const sections = /SETTINGS_SECTIONS = \[(?<body>[\s\S]*?)\] as const;/u.exec(settingsStore)
      ?.groups?.body;

    expect(sections).toContain('"bots"');
    expect(botsPage).toContain('to: "/settings/bots/$botId"');
  });
});

describe("global settings stay global", () => {
  it("keeps the app-wide voice toggle out of per-bot settings", () => {
    const voice = read("../settings/voice-settings.tsx");
    const botSettings = readBotSettingsSource();

    expect(voice).toContain("settings.voice");
    // The bot owns only its own participation.
    expect(botSettings).toContain("draft.voiceEnabled");
    expect(botSettings).not.toContain("updateSettings(");
  });
});

describe("per-bot image provider", () => {
  it("maps select values to the saved provider and treats unknown values as the default", () => {
    expect(botImageProviderFromSelectValue(BOT_IMAGE_PROVIDER_DEFAULT)).toBeNull();
    expect(botImageProviderFromSelectValue("grok")).toBe("grok");
    expect(botImageProviderFromSelectValue("chatgpt")).toBe("chatgpt");
    expect(botImageProviderFromSelectValue("dall-e")).toBeNull();
  });

  it("keeps image settings out of the chat composer", () => {
    const composer = read("./bot-prompt-composer.tsx");
    expect(composer).not.toContain("imageProvider");
    expect(composer).not.toContain("image-generation");
  });
});
