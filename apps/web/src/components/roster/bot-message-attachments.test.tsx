import { describe, expect, it } from "vite-plus/test";

import { attachmentDetails, attachmentLightboxFile } from "./bot-message-attachments";

describe("sent bot message attachments", () => {
  it("describes an attachment by size and type, like Capy", () => {
    expect(attachmentDetails({ name: "Screenshot.png", sizeBytes: 142_336 })).toBe("139 KB · PNG");
    expect(attachmentDetails({ name: "notes", sizeBytes: 900 })).toBe("900 B");
    expect(attachmentDetails({ name: "deck.pdf", sizeBytes: 3_250_000 })).toBe("3.1 MB · PDF");
  });

  it("opens each attachment in the lightbox by its name, then its type", () => {
    const kind = (name: string, mimeType: string) =>
      attachmentLightboxFile({ name, mimeType }, null).kind;

    expect(kind("f", "image/png")).toBe("image");
    expect(kind("f", "application/pdf")).toBe("pdf");
    expect(kind("f", "video/mp4")).toBe("video");
    expect(kind("f", "video/webm")).toBe("video");
    expect(kind("f", "text/csv")).toBe("sheet");
    expect(kind("report.docx", "application/octet-stream")).toBe("docx");
    expect(kind("slides.pptx", "application/octet-stream")).toBe("file");
  });
});
