import { expect, test } from "./live-app";

test("real account registration preserves separate workspace authority", async ({
  page,
  fixture,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in to Otto" }).waitFor();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Otto Browser Owner");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`browser-${crypto.randomUUID()}@example.test`);
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
  await fixture.grant(userId);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(
    page.getByText("Nothing needs you", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Nothing needs you", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "docs/evidence/generated-web-playwright.png" });
  expect(errors).toEqual([]);
});
