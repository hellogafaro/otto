import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { memoryDocumentCopy } from "./botMemoryCopy";
import { memoryErrorMessage } from "./BotMemorySheet";

describe("BotMemorySheet", () => {
  it("renders direct document editors, limits, and chat summary controls", () => {
    const source = NodeFS.readFileSync(new URL("./BotMemorySheet.tsx", import.meta.url), "utf8");
    expect(source).toContain('data-testid="memory-documents"');
    expect(source).toContain("document.charLimit");
    expect(source).toContain("Chat summary");
    expect(source).toContain("Earlier summaries");
    expect(source).toContain("Confirm clear");
    expect(source).toContain('role="alert"');
    expect(source).not.toContain("font-mono");
  });

  it("names every memory document in plain language and keeps its file name", () => {
    expect(memoryDocumentCopy.user).toMatchObject({ title: "About you", fileName: "USER.md" });
    expect(memoryDocumentCopy.memory).toMatchObject({ title: "Bot notes", fileName: "MEMORY.md" });
    expect(memoryDocumentCopy.group).toMatchObject({ title: "Group notes", fileName: "GROUP.md" });
  });

  it("imports backups through an app button instead of a raw file input", () => {
    const source = NodeFS.readFileSync(new URL("./BotMemoryTransfer.tsx", import.meta.url), "utf8");
    expect(source).toContain('type="file"');
    expect(source).toContain('className="sr-only"');
    expect(source).toContain("fileInputRef.current?.click()");
    expect(source).toContain('t("Import memory archive")');
  });

  it("keeps durable facts in their own section apart from chat memory", () => {
    const source = NodeFS.readFileSync(new URL("./BotMemorySheet.tsx", import.meta.url), "utf8");
    const durable = NodeFS.readFileSync(new URL("./BotDurableMemory.tsx", import.meta.url), "utf8");
    expect(source.indexOf("Observational memory")).toBeLessThan(
      source.indexOf("<BotDurableMemory"),
    );
    expect(durable).toContain("Durable facts");
    expect(durable).toContain("DURABLE_MEMORY_INSPECT_SCOPES");
    expect(durable).toContain("Clearing chat observations does not remove them.");
  });

  it("opens memory imports from an app button instead of a native file control", () => {
    const transfer = NodeFS.readFileSync(
      new URL("./BotMemoryTransfer.tsx", import.meta.url),
      "utf8",
    );

    expect(transfer).toContain("onClick={() => fileInputRef.current?.click()}");
    expect(transfer).toMatch(/>\s*\{t\("Import memory archive"\)\}\s*</);
    expect(transfer).toMatch(/<input\s+ref=\{fileInputRef\}\s+className="sr-only"/);
    expect(transfer).not.toContain('aria-label={t("Import memory archive")}');
  });

  it("keeps server failures and falls back for unknown errors", () => {
    expect(memoryErrorMessage(new Error("Memory is too large."))).toBe("Memory is too large.");
    expect(memoryErrorMessage(null)).toBeNull();
  });

  it("binds memory to the bot's latest chat from its settings", () => {
    const form = NodeFS.readFileSync(new URL("./BotSettingsForm.tsx", import.meta.url), "utf8");

    expect(form).toContain("useLatestBotChatRef(bot.id)");
    expect(form).toContain("threadRef={threadRef}");
  });
});
