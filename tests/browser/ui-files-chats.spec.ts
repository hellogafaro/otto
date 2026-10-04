import { readFile } from "node:fs/promises";
import { register } from "./account";
import { expect, test } from "./live-app";

test("Files save binary bytes, organize folders, download and publish frozen shares", async ({
  page,
  fixture,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { workspaceId } = await register(page, fixture, "Files Owner");
  await page.goto("/files");
  await expect(
    page.getByRole("button", { name: "Add", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "New folder", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Saved folder");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "New folder", exact: true }),
  ).not.toBeVisible();
  await page.getByText("Saved folder", { exact: true }).click();
  await page.waitForURL((url) => Boolean(url.searchParams.get("folder")));
  const folderId = new URL(page.url()).searchParams.get("folder");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "verified.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Verified real file bytes"),
    });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await page.getByText("verified.txt", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Download", exact: true }),
  ).toBeEnabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error("Downloaded file missing");
  expect(await readFile(path, "utf8")).toBe("Verified real file bytes");
  await page.getByRole("button", { name: "Edit file", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Renamed verified.txt");
  await page
    .getByLabel("Labels, separated by commas", { exact: true })
    .fill("Exact Label");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit file", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Share selected file", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Include downloadable file bytes",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Preview selection", exact: true })
    .click();
  await expect(
    page.getByText("24 bytes included", { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: "docs/evidence/ui-file-share-dialog.png" });
  await page
    .getByRole("button", { name: "Publish to internet", exact: true })
    .click();
  const link = await page.locator("input[readonly]").inputValue();
  expect(link).toMatch(/\/shares\/[0-9a-f-]{36}$/);
  const anonymous = await browser.newContext();
  try {
    const publicPage = await anonymous.newPage();
    await publicPage.goto(link);
    await expect(
      publicPage.getByRole("heading", {
        name: "Renamed verified.txt",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      publicPage.getByText("Exact Label", { exact: true }),
    ).toBeVisible();
    await expect(
      publicPage.getByRole("button", { name: "Open profile menu" }),
    ).toHaveCount(0);
    await publicPage.screenshot({ path: "docs/evidence/ui-public-share.png" });
  } finally {
    await anonymous.close();
  }
  const result = await page.evaluate(
    async ({ workspaceId }) =>
      (
        await (
          await fetch(`/api/workspaces/${workspaceId}/files?limit=100`)
        ).json()
      ).items.map((file: { title: string; folderId: string }) => ({
        title: file.title,
        folderId: file.folderId,
      })),
    { workspaceId, folderId },
  );
  expect(result).toContainEqual({ title: "Renamed verified.txt", folderId });
  expect(errors).toEqual([]);
});

test("Chats persist acknowledged messages, reply and retain failed drafts", async ({
  page,
  fixture,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await register(page, fixture, "Chats Owner");
  await page.goto("/chats/new");
  const composer = page.getByRole("textbox", {
    name: "Write your first message",
    exact: true,
  });
  await expect(composer).toHaveAttribute("contenteditable", "true");
  await composer.fill("First saved message");
  await composer.press("Enter");
  await page.waitForURL((url) => /\/chats\/[0-9a-f-]{36}$/.test(url.pathname));
  await expect(
    page.getByRole("log").getByText("First saved message", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("log").getByText("First saved message", { exact: true }),
  ).toBeVisible();
  const active = page.locator('[contenteditable="true"]').last();
  await active.fill("Second saved message");
  await active.press("Enter");
  await expect(
    page.getByRole("log").getByText("Second saved message", { exact: true }),
  ).toBeVisible();
  await page.route("**/messages", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"unavailable"}',
        })
      : route.continue(),
  );
  await active.fill("Draft after failure");
  await active.press("Enter");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "This service is unavailable, try again later." }),
  ).toBeVisible();
  await expect(active).toHaveText("Draft after failure");
  await page.unroute("**/messages");
  await active.press("Enter");
  await expect(
    page.getByRole("log").getByText("Draft after failure", { exact: true }),
  ).toBeVisible();
  await expect(active).not.toHaveText("Draft after failure");
  await page.screenshot({ path: "docs/evidence/ui-chat-desktop.png" });
  await page.reload();
  await expect(
    page.getByRole("log").getByText("Draft after failure", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
