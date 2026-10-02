import { describe, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { createLogger } from "../apps/server/src/logger";

describe("Bun server foundation", () => {
  it("runs Vitest workers under Bun", () => {
    expect(Bun.version).toBeDefined();
    expect(Bun.spawnSync(["bun", "--version"]).exitCode).toBe(0);
  });
  it("reports unavailable compute without pretending to execute", async () => {
    const response = await createApp().request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      execution: { available: false, reason: "compute_provider_not_selected" },
    });
  });
  it("rejects oversized requests", async () => {
    const response = await createApp().request("/api/auth/sign-up/email", {
      method: "POST",
      body: "x".repeat(1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
  });
  it("redacts sensitive fields under Bun", () => {
    const lines: string[] = [];
    const log = createLogger({
      write: (line) => {
        lines.push(line);
      },
    });
    log.info({
      token: "redaction-fixture",
      headers: { cookie: "redaction-fixture" },
    });
    expect(lines.join("")).not.toContain("redaction-fixture");
    expect(lines.join("")).toContain("[REDACTED]");
  });
});
