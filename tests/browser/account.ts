import type { Page } from "@playwright/test";
import type { startUiApp } from "../fixtures/ui-app";
import { expect } from "./live-app";

let fixtureAddress = 0;

export async function register(
  page: Page,
  fixture: Awaited<ReturnType<typeof startUiApp>>,
  name: string,
  role: "owner" | "contributor" | "viewer" = "owner",
) {
  // Distinct controlled clients keep production auth throttling enabled during a serial multi-user suite.
  await page
    .context()
    .setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${++fixtureAddress}` });
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in to Otto" }).waitFor();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`qa-${crypto.randomUUID()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill(crypto.randomUUID() + crypto.randomUUID());
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByText("No workspace access.", { exact: false }),
  ).toBeVisible();
  const userId = await page.evaluate(
    async () =>
      (await (await fetch("/api/auth/get-session")).json()).user.id as string,
  );
  const workspaceId = await fixture.grant(userId, role);
  await page.getByRole("button", { name: "Check again" }).click();
  await page
    .getByRole("button", { name: "Open profile menu", exact: true })
    .waitFor();
  return { userId, workspaceId };
}
