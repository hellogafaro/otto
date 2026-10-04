import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "*.spec.ts",
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:45183",
    headless: true,
    video: "on",
    trace: "off",
    viewport: { width: 1280, height: 800 },
  },
});
