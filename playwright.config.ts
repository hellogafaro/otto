import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:45174",
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command:
      "bun --bun run --cwd apps/web build && bun --bun run --cwd apps/web preview --host 127.0.0.1 --port 45174",
    url: "http://127.0.0.1:45174",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
