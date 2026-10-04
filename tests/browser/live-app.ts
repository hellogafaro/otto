import { test as base } from "@playwright/test";
import { startUiApp } from "../fixtures/ui-app";

export const test = base.extend<
  object,
  { fixture: Awaited<ReturnType<typeof startUiApp>> }
>({
  fixture: [
    async ({ playwright: _playwright }, use) => {
      const fixture = await startUiApp("http://127.0.0.1:45183");
      const web = Bun.spawn(
        [
          process.execPath,
          "--bun",
          "run",
          "--cwd",
          "apps/web",
          "dev",
          "--host",
          "127.0.0.1",
          "--port",
          "45183",
          "--strictPort",
        ],
        {
          stdout: "ignore",
          stderr: "ignore",
          env: { ...process.env, OTTO_API_ORIGIN: fixture.apiOrigin },
        },
      );
      try {
        for (let attempt = 0; ; attempt++) {
          if ((await fetch(fixture.origin).catch(() => null))?.ok) break;
          if (attempt > 100)
            throw new Error("Fixture web server did not start");
          await Bun.sleep(100);
        }
        await use(fixture);
      } finally {
        web.kill("SIGTERM");
        await web.exited;
        await fixture.stop();
      }
    },
    { scope: "worker", timeout: 120000 },
  ],
});
export { expect } from "@playwright/test";
