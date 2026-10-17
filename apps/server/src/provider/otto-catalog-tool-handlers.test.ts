import { describe } from "vite-plus/test";
import { expect, it, vi } from "vite-plus/test";
import { createOttoCatalogToolHandlers } from "./otto-catalog-tool-handlers.ts";

describe("Otto catalog MCP tool handlers", () => {
  it.each([
    "http://127.0.0.1:8080/",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "https://user:password@example.com/",
  ])("rejects unsafe WebFetch URL %s before the backend runs", async (url) => {
    const webFetch = vi.fn(async () => ({ text: "page" }));
    const handlers = createOttoCatalogToolHandlers(undefined, undefined, undefined, { webFetch });
    await expect(handlers.web_fetch!({ input: { url }, emitProgress: vi.fn() })).rejects.toThrow();
    expect(webFetch).not.toHaveBeenCalled();
  });

  it("shows a long page in parts that offset reads on from", async () => {
    const page = Array.from({ length: 3_000 }, (_, index) => `line ${index + 1}`).join("\n");

    const handlers = createOttoCatalogToolHandlers(undefined, undefined, undefined, {
      webFetch: async () => ({ text: page }),
    });

    const read = (offset?: number) =>
      handlers.web_fetch!({
        input: { url: "https://example.com", ...(offset === undefined ? {} : { offset }) },
        emitProgress: vi.fn(),
      });

    const first = await read();
    const next = Number(/Use offset=(\d+) to read more/.exec(String(first))?.[1]);

    expect(first).toMatch(/^line 1\n[\s\S]*\nline 1998\n\n\[Showing /);
    expect(next).toBe(page.indexOf("line 1999"));
    await expect(read(next)).resolves.toBe(page.slice(next));
    await expect(read(page.length)).resolves.toBe(
      `The page has ${page.length} characters, so offset ${page.length} is past its end.`,
    );
  });

  it("runs the M2-T6 backends and aliases image generation", async () => {
    const calls: string[] = [];

    const handlers = createOttoCatalogToolHandlers(undefined, undefined, undefined, {
      webSearch: async (input) => {
        calls.push(`search:${input.query}`);

        return { results: [] };
      },
      webFetch: async (input) => {
        calls.push(`fetch:${input.url}`);

        return { text: "page" };
      },
      generateImage: async (input) => {
        calls.push(`image:${input.prompt}`);

        return { url: "https://img" };
      },
      addMcpServer: async (input) => {
        calls.push(`add:${input.title}`);

        return { added: true };
      },
      uninstallMcpServer: async (id) => {
        calls.push(`uninstall:${id}`);

        return { removed: true };
      },
      renameMcpAccount: async (input) => {
        calls.push(`rename:${input.name}`);

        return { renamed: true };
      },
      setMcpInstructions: async () => {
        calls.push("instructions");

        return { saved: true };
      },
    });

    await handlers.web_search!({ input: { query: "otto" }, emitProgress: vi.fn() });
    await handlers.web_fetch!({ input: { url: "https://example.com" }, emitProgress: vi.fn() });
    await handlers.image_create!({
      input: { operation: "generate", prompt: "a cat" },
      emitProgress: vi.fn(),
    });

    await handlers.connection_create!({
      input: { url: "https://example.com/mcp", title: "One" },
      emitProgress: vi.fn(),
    });
    await handlers.connection_delete!({ input: { id: "one" }, emitProgress: vi.fn() });
    await handlers.connection_update!({
      input: { id: "one", title: "two", instructions: "keep safe" },
      emitProgress: vi.fn(),
    });
    expect(calls).toEqual([
      "search:otto",
      "fetch:https://example.com/",
      "image:a cat",
      "add:One",
      "uninstall:one",
      "rename:two",
      "instructions",
    ]);
    await expect(handlers.connection_delete!({ input: {}, emitProgress: vi.fn() })).rejects.toThrow(
      "id",
    );
  });
});
