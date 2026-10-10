import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("forwards only explicitly configured anonymous MCP through the durable launcher", async () => {
  const directory = await mkdtemp(join(tmpdir(), "otto-launcher-"));
  try {
    const preload = join(directory, "observe.ts");
    await writeFile(
      preload,
      `
Bun.spawn = (command, options) => {
  if (command[2] !== "apps/server/src/index.ts") throw new Error("Unexpected child");
  console.log(JSON.stringify({
    anonymous: options.env.MCP_ALLOW_ANONYMOUS ?? null,
    origin: options.env.MCP_ORIGIN ?? null,
    unrelatedForwarded: Object.hasOwn(options.env, "UNRELATED_FIXTURE_VALUE"),
  }));
  return { exited: Promise.resolve(0), kill() {} };
};
`,
    );
    for (const mode of ["disabled", "anonymous", "missing-origin"] as const) {
      const child = Bun.spawn(
        [
          process.execPath,
          "--no-env-file",
          "--preload",
          preload,
          "scripts/durable-dev.ts",
          "server",
        ],
        {
          cwd: resolve(import.meta.dirname, ".."),
          env: {
            HOME: directory,
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
            ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
            UNRELATED_FIXTURE_VALUE: "never-forward",
            ...(mode === "disabled" ? {} : { MCP_ALLOW_ANONYMOUS: "true" }),
            ...(mode === "anonymous"
              ? { MCP_ORIGIN: "https://docs.mcp.cloudflare.com" }
              : {}),
          },
          stdout: "pipe",
          stderr: "pipe",
          timeout: 10000,
        },
      );
      const [output, error, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (mode === "missing-origin") {
        expect(code).toBe(1);
        expect(output).toBe("");
        expect(error).toContain(
          "Durable local service failed; no secret values were logged",
        );
      } else {
        expect(code).toBe(0);
        expect(error).toBe("");
        expect(JSON.parse(output)).toEqual({
          anonymous: mode === "anonymous" ? "true" : null,
          origin:
            mode === "anonymous" ? "https://docs.mcp.cloudflare.com" : null,
          unrelatedForwarded: false,
        });
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
