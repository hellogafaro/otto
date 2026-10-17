import { describe, expect, it } from "vite-plus/test";

import { attachmentDetails, attachmentLightboxFile } from "./bot-message-attachments";

describe("sent bot message attachments", () => {
  it("describes an attachment by size and type, like Capy", () => {
    expect(attachmentDetails({ name: "Screenshot.png", sizeBytes: 142_336 })).toBe("139 KB · PNG");
    expect(attachmentDetails({ name: "notes", sizeBytes: 900 })).toBe("900 B");
    expect(attachmentDetails({ name: "deck.pdf", sizeBytes: 3_250_000 })).toBe("3.1 MB · PDF");
  });

  it("previews images, PDFs and videos in the lightbox and offers the rest as downloads", () => {
    const kind = (mimeType: string) => attachmentLightboxFile({ name: "f", mimeType }, null).kind;

    expect(kind("image/png")).toBe("image");
    expect(kind("application/pdf")).toBe("pdf");
    expect(kind("video/mp4")).toBe("video");
    expect(kind("video/webm")).toBe("video");
    expect(kind("text/csv")).toBe("file");
  });
});
