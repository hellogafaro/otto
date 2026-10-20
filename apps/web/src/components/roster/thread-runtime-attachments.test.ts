import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  readFileAsDataUrl,
  readThreadTurnAttachments,
  threadTitle,
} from "./thread-runtime-attachments";

type ReaderOutcome = { readonly result: string | ArrayBuffer | null } | { readonly error: Error };

function stubFileReader(outcome: ReaderOutcome) {
  class StubFileReader extends EventTarget {
    result: string | ArrayBuffer | null = null;
    error: Error | null = null;
    readAsDataURL() {
      queueMicrotask(() => {
        if ("error" in outcome) {
          this.error = outcome.error;
          this.dispatchEvent(new Event("error"));

          return;
        }

        this.result = outcome.result;
        this.dispatchEvent(new Event("load"));
      });
    }
  }

  vi.stubGlobal("FileReader", StubFileReader);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("threadTitle", () => {
  it("uses the prompt, then the first file, then a default", () => {
    const file = new File(["x"], "notes.md");
    expect(threadTitle("Plan the week", [file])).toBe("Plan the week");
    expect(threadTitle("", [file])).toBe("File: notes.md");
    expect(threadTitle("", [])).toBe("New chat");
  });

  it("caps long titles at 80 characters with an ellipsis", () => {
    const title = threadTitle("a".repeat(81), []);
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
    expect(threadTitle("b".repeat(80), [])).toBe("b".repeat(80));
  });
});

describe("readFileAsDataUrl", () => {
  it("relabels the data URL with the resolved MIME type", async () => {
    stubFileReader({ result: "data:application/octet-stream;base64,QUJD" });
    await expect(readFileAsDataUrl(new File(["ABC"], "a.md"), "text/markdown")).resolves.toBe(
      "data:text/markdown;base64,QUJD",
    );
  });

  it("rejects with the reader error", async () => {
    const failure = new Error("disk gone");
    stubFileReader({ error: failure });
    await expect(readFileAsDataUrl(new File(["x"], "a.png"), "image/png")).rejects.toBe(failure);
  });

  it("rejects with a named message when the result is not text", async () => {
    stubFileReader({ result: null });
    await expect(readFileAsDataUrl(new File(["x"], "a.png"), "image/png")).rejects.toThrow(
      "Could not read a.png.",
    );
  });
});

describe("readThreadTurnAttachments", () => {
  it("builds image attachments with name, size, and data URL", async () => {
    stubFileReader({ result: "data:image/png;base64,AAAA" });
    const file = new File(["png"], "shot.png", { type: "image/png" });
    await expect(readThreadTurnAttachments([file], vi.fn())).resolves.toEqual([
      {
        type: "image",
        mimeType: "image/png",
        name: "shot.png",
        sizeBytes: 3,
        dataUrl: "data:image/png;base64,AAAA",
      },
    ]);
  });

  it("sends an image wider than models take downscaled as WebP", async () => {
    stubFileReader({ result: "data:image/webp;base64,AAAA" });
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4112, height: 2658, close: vi.fn() })),
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
        }
        async convertToBlob({ type }: { type: string }) {
          return new Blob([new Uint8Array(300_000)], { type });
        }
      },
    );

    // The PNG header declares 4112 × 2658 pixels.
    const header = new Uint8Array(24);
    const view = new DataView(header.buffer);
    header.set([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    ]);
    view.setUint32(16, 4112);
    view.setUint32(20, 2658);

    await expect(
      readThreadTurnAttachments([new File([header], "shot.png", { type: "image/png" })], vi.fn()),
    ).resolves.toEqual([
      {
        type: "image",
        mimeType: "image/webp",
        name: "shot.webp",
        sizeBytes: 300_000,
        dataUrl: "data:image/webp;base64,AAAA",
      },
    ]);
  });

  it("uploads other files first and names them by their pending id", async () => {
    const upload = vi.fn(async () => "pending-1");
    const file = new File(["zip"], "bundle.zip", { type: "application/zip" });

    await expect(readThreadTurnAttachments([file], upload)).resolves.toEqual([
      {
        type: "file",
        mimeType: "application/zip",
        id: "pending-1",
        name: "bundle.zip",
        sizeBytes: 3,
      },
    ]);
    expect(upload).toHaveBeenCalledWith(file, "application/zip");
  });

  it("rejects an empty file by name", async () => {
    await expect(
      readThreadTurnAttachments([new File([], "empty.txt", { type: "text/plain" })], vi.fn()),
    ).rejects.toThrow("This file type is not supported: empty.txt");
  });
});
