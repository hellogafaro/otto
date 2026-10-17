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
