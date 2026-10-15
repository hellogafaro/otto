import { describe, expect, it } from "vite-plus/test";

import { attachmentDetails } from "./BotMessageAttachments";

describe("sent bot message attachments", () => {
  it("describes an attachment by size and type, like Capy", () => {
    expect(attachmentDetails({ name: "Screenshot.png", sizeBytes: 142_336 })).toBe("139 KB · PNG");
    expect(attachmentDetails({ name: "notes", sizeBytes: 900 })).toBe("900 B");
    expect(attachmentDetails({ name: "deck.pdf", sizeBytes: 3_250_000 })).toBe("3.1 MB · PDF");
  });
});
