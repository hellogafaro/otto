import { describe, expect, it, vi } from "vite-plus/test";

import { BotWorkspaceFilesystem } from "./bot-workspace-filesystem.ts";

describe("BotWorkspaceFilesystem", () => {
  it("reads and writes binary-safe content through the remote command session", async () => {
    const run = vi.fn(async (_command: string, args: readonly string[]) => ({
      exitCode: 0,
      stdout: args[1]?.startsWith("base64")
        ? Buffer.from("remote contents").toString("base64")
        : "",
      stderr: "",
    }));

    const filesystem = new BotWorkspaceFilesystem("workspace", "e2b", { run });

    await expect(filesystem.readFile("file.txt", { encoding: "utf8" })).resolves.toBe(
      "remote contents",
    );
    await filesystem.writeFile("file.txt", Buffer.from([0, 1, 2]));

    expect(run).toHaveBeenNthCalledWith(1, "sh", ["-c", "base64 < 'file.txt'"]);
    expect(run.mock.calls[1]?.[1]?.[1]).toContain(Buffer.from([0, 1, 2]).toString("base64"));
  });

  it("reports the size and image type of a screenshot", async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: "regular file\u001f2048\u001f0\u001f1760000000",
      stderr: "",
    }));

    const filesystem = new BotWorkspaceFilesystem("workspace", "boat", { run });

    await expect(filesystem.stat("/tmp/page.PNG")).resolves.toMatchObject({
      type: "file",
      size: 2048,
      mimeType: "image/png",
    });
    expect(run).toHaveBeenCalledWith("stat", [
      "--printf",
      "%F\\037%s\\037%W\\037%Y",
      "--",
      "/tmp/page.PNG",
    ]);
    await expect(filesystem.stat("/tmp/notes.txt")).resolves.not.toHaveProperty("mimeType");
  });
});
