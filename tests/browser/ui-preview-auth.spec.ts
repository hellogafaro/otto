import { test as base, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { users } from "../../packages/workspaces/src/schema";
import { startUiApp } from "../fixtures/ui-app";

const origin = "http://127.0.0.1:45203";
const publicOrigin = "https://otto-preview.example.test";
const test = base.extend<{
  fixture: Awaited<ReturnType<typeof startUiApp>>;
}>({
  fixture: async ({ playwright: _playwright }, use) => {
    const fixture = await startUiApp(publicOrigin);
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
        "45203",
        "--strictPort",
      ],
      {
        stdout: "ignore",
        stderr: "ignore",
        env: {
          ...process.env,
          OTTO_UI_ORIGIN: publicOrigin,
          OTTO_API_ORIGIN: fixture.apiOrigin,
        },
      },
    );
    try {
      for (let attempt = 0; ; attempt++) {
        if ((await fetch(origin).catch(() => null))?.ok) break;
        if (attempt > 100) throw new Error("Preview did not start");
        await Bun.sleep(100);
      }
      await use(fixture);
    } finally {
      web.kill("SIGTERM");
      await web.exited;
      await fixture.stop();
    }
  },
});

test("BB loopback origin signs in and mutates; unrelated origins remain denied", async ({
  page,
  request,
  fixture,
}, testInfo) => {
  // BB Connect rewrites only the exact public Origin to this frontend loopback origin.
  const failed = await request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin, "x-forwarded-for": "192.0.2.240" },
    data: { email: "missing@example.test", password: crypto.randomUUID() },
  });
  expect(failed.status()).toBe(401);
  for (const badOrigin of [
    "https://unrelated.example.test",
    "http://127.0.0.1:45204",
  ]) {
    const denied = await request.post(`${origin}/api/auth/sign-in/email`, {
      headers: { origin: badOrigin, "x-forwarded-for": "192.0.2.240" },
      data: { email: "missing@example.test", password: crypto.randomUUID() },
    });
    expect(denied.status()).toBe(403);
  }
  await page
    .context()
    .setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.241" });
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "Sign in to Otto" }),
  ).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const dark of [false, true]) {
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        dark,
      );
      const form = await page.locator("form").boundingBox();
      expect(form).not.toBeNull();
      expect(form?.width).toBeLessThanOrEqual(336);
      expect(
        Math.abs((form?.x ?? 0) + (form?.width ?? 0) / 2 - width / 2),
      ).toBeLessThan(1);
      await page.screenshot({
        path: testInfo.outputPath(
          `login-${width}-${dark ? "dark" : "light"}.png`,
        ),
      });
    }
  }
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const email = `preview-${crypto.randomUUID()}@example.test`;
  const password = crypto.randomUUID() + crypto.randomUUID();
  await page.getByLabel("Name", { exact: true }).fill("Preview tester");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByText("No workspace access.", { exact: false }),
  ).toBeVisible();
  const [user] = await fixture.database.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (!user) throw new Error("Signup not persisted");
  const workspaceId = await fixture.grant(user.id);
  await page.reload();
  const statuses = await page.evaluate(
    async ({ workspaceId }) => {
      return (
        await fetch(`/api/workspaces/${workspaceId}/projects`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Preview origin project" }),
        })
      ).status;
    },
    { workspaceId },
  );
  expect(statuses).toBe(200);
  // Browsers cannot override Origin themselves; explicit hostile origins were exercised above over HTTP.
  const badMutation = await request.post(
    `${origin}/api/workspaces/${workspaceId}/projects`,
    {
      headers: { origin: "https://unrelated.example.test" },
      data: { title: "Denied" },
    },
  );
  expect(badMutation.status()).toBe(403);
  await page.evaluate(async () => {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  });
  await page.reload();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open profile menu", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open profile menu", exact: true }),
  ).toBeVisible();
});
