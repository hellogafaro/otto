import { describe, expect, it } from "vite-plus/test";

import { resolveBotFileAttachment } from "./bot-file-attachment";

describe("resolveBotFileAttachment", () => {
  it("accepts supported images and documents", () => {
    expect(resolveBotFileAttachment({ name: "image.png", size: 3, type: "image/png" })).toEqual({
      type: "image",
      mimeType: "image/png",
    });
    expect(resolveBotFileAttachment({ name: "notes.md", size: 3, type: "" })).toEqual({
      type: "file",
      mimeType: "text/markdown",
    });
    expect(
      resolveBotFileAttachment({ name: "report.pdf", size: 3, type: "application/pdf" }),
    ).toEqual({ type: "file", mimeType: "application/pdf" });
  });

  it("accepts office files and archives by extension", () => {
    expect(resolveBotFileAttachment({ name: "plan.xlsx", size: 3, type: "" })).toEqual({
      type: "file",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(
      resolveBotFileAttachment({ name: "bundle.zip", size: 3, type: "application/x-zip" }),
    ).toEqual({ type: "file", mimeType: "application/zip" });
  });

  it("keeps active content and unknown files as plain downloads and rejects empty or huge files", () => {
    for (const file of [
      { name: "page.html", size: 3, type: "text/html" },
      { name: "vector.svg", size: 3, type: "image/svg+xml" },
      { name: "tool.exe", size: 3, type: "application/x-msdos" },
    ]) {
      expect(resolveBotFileAttachment(file)).toEqual({
        type: "file",
        mimeType: "application/octet-stream",
      });
    }

    expect(resolveBotFileAttachment({ name: "notes.txt", size: 0, type: "text/plain" })).toBeNull();
    expect(
      resolveBotFileAttachment({ name: "huge.zip", size: 100_000_001, type: "application/zip" }),
    ).toBeNull();
  });
});
