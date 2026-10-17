import { describe, expect, it } from "vite-plus/test";

import { fileLightboxKind } from "./file-lightbox";

describe("file lightbox kinds", () => {
  const kind = (name: string, mimeType?: string) => fileLightboxKind(name, mimeType).kind;

  it("previews everyday files by their extension", () => {
    expect(kind("photo.JPG")).toBe("image");
    expect(kind("deck.pdf")).toBe("pdf");
    expect(kind("clip.webm")).toBe("video");
    expect(kind("README.md")).toBe("markdown");
    expect(kind("notes.markdown")).toBe("markdown");
    expect(kind("export.csv")).toBe("sheet");
    expect(kind("budget.xlsx")).toBe("sheet");
    expect(kind("legacy.xls")).toBe("sheet");
    expect(kind("letter.docx")).toBe("docx");
    expect(kind("server.log")).toBe("text");
    expect(kind("config.yaml")).toBe("text");
    expect(kind("page.html")).toBe("text");
    expect(kind("bundle.zip")).toBe("zip");
  });

  it("falls back to the MIME type, ignoring its parameters", () => {
    expect(kind("upload", "text/markdown; charset=utf-8")).toBe("markdown");
    expect(kind("upload", "text/csv")).toBe("sheet");
    expect(kind("upload", "text/plain")).toBe("text");
    expect(kind("upload", "application/json")).toBe("text");
    expect(kind("upload", "application/zip")).toBe("zip");
    expect(kind("upload", "image/heic")).toBe("image");
  });

  it("lets the extension win over a generic MIME type", () => {
    expect(kind("letter.docx", "application/octet-stream")).toBe("docx");
    expect(kind("data.csv", "text/plain")).toBe("sheet");
  });

  it("offers the download for files it can't preview", () => {
    expect(kind("letter.doc", "application/msword")).toBe("file");
    expect(kind("slides.pptx")).toBe("file");
    expect(kind("song.mp3", "audio/mpeg")).toBe("file");
    expect(kind("archive.tar.gz", "application/gzip")).toBe("file");
    expect(kind("noextension")).toBe("file");
  });

  it("gives each kind its own icon", () => {
    expect(fileLightboxKind("a.md").icon).not.toBe(fileLightboxKind("a.txt").icon);
    expect(fileLightboxKind("a.json").icon).not.toBe(fileLightboxKind("a.txt").icon);
    expect(fileLightboxKind("a.xlsx").icon).toBe(fileLightboxKind("a.csv").icon);
  });
});
