import { register } from "./account";
import { expect, test } from "./live-app";

test.use({ launchOptions: { executablePath: process.env.OTTO_TEST_CHROMIUM } });

test("full, new, and floating chats share a multiline composer and visible context", async ({
  page,
  fixture,
}, testInfo) => {
  const { workspaceId } = await register(page, fixture, "Composer owner");
  const base = `/api/workspaces/${workspaceId}`;
  const headers = { origin: fixture.origin };
  const projectResponse = await page.request.post(`${base}/projects`, {
    headers,
    data: { title: "Composer project" },
  });
  expect(projectResponse.status()).toBe(200);
  const projectId = (await projectResponse.json()).id as string;
  const chatResponse = await page.request.post(`${base}/chats`, {
    headers,
    data: {
      title: "Composer discussion",
      visibility: "workspace",
      projectId,
    },
  });
  expect(chatResponse.status()).toBe(200);
  const chatId = (await chatResponse.json()).id as string;

  await page.goto(`/chats/new?project=${projectId}`);
  const newComposer = page.getByLabel("Write your first message");
  await expect(newComposer).toBeVisible();
  await expect(
    page.getByRole("button", { name: "With: Participants" }),
  ).toBeVisible();
  await expect(page.getByLabel("Project: Composer project")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add files" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dictat/ })).toBeVisible();
  const newEditorBox = await newComposer.boundingBox();
  const newWidth = (
    await newComposer
      .locator("xpath=ancestor::*[@data-slot='input-group']")
      .boundingBox()
  )?.width;
  const newPlusBox = await page
    .getByRole("button", { name: "Add files" })
    .boundingBox();
  const newProjectBox = await page
    .getByLabel("Project: Composer project")
    .boundingBox();
  expect(
    Math.abs(
      (newPlusBox?.y ?? 0) +
        (newPlusBox?.height ?? 0) / 2 -
        ((newEditorBox?.y ?? 0) + (newEditorBox?.height ?? 0) / 2),
    ),
  ).toBeLessThan(8);
  expect(newProjectBox?.y).toBeGreaterThan(
    (newEditorBox?.y ?? 0) + (newEditorBox?.height ?? 0),
  );
  await newComposer.fill("first");
  await newComposer.press("Shift+Enter");
  await newComposer.type("second");
  expect(
    await newComposer.evaluate((element) =>
      element instanceof HTMLElement ? element.innerText : "",
    ),
  ).toMatch(/first\s+second/);
  await newComposer.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "pasted first\npasted second");
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData }),
    );
  });
  expect(
    await newComposer.evaluate((element) =>
      element instanceof HTMLElement ? element.innerText : "",
    ),
  ).toMatch(/pasted first\s+pasted second/);
  await page.screenshot({
    path: testInfo.outputPath("new-inline-composer.png"),
  });

  await page.goto(`/chats/${chatId}`);
  const fullComposer = page.getByLabel("Message Composer discussion, @ to tag");
  await expect(fullComposer).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Participants", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Project: Composer project")).toBeVisible();
  await page.getByRole("button", { name: "Participants", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await fullComposer.fill("Human-only message");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Human-only message")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Human-only message")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("full-inline-composer.png"),
  });

  await page.goto("/");
  const floating = page.getByRole("dialog", { name: "Chat" });
  const floatingComposer = floating.getByLabel("Message about this page");
  await expect(floatingComposer).toBeVisible();
  await expect(
    floating.getByRole("button", { name: "With: Participants" }),
  ).toBeVisible();
  await expect(floating.getByText("No project", { exact: true })).toBeVisible();
  await expect(
    floating.getByRole("button", { name: "Add files" }),
  ).toBeVisible();
  const floatingEditorBox = await floatingComposer.boundingBox();
  const floatingProjectBox = await floating
    .getByText("No project", { exact: true })
    .boundingBox();
  expect(floatingProjectBox?.y).toBeGreaterThan(
    (floatingEditorBox?.y ?? 0) + (floatingEditorBox?.height ?? 0),
  );
  await floatingComposer.fill("floating first");
  await floatingComposer.press("Shift+Enter");
  await floatingComposer.type("floating second");
  expect(
    await floatingComposer.evaluate((element) =>
      element instanceof HTMLElement ? element.innerText : "",
    ),
  ).toMatch(/floating first\s+floating second/);
  const width = (
    await floating.locator("form [data-slot=input-group]").boundingBox()
  )?.width;
  expect(width).toBeGreaterThan(600);
  expect(width).toBeLessThanOrEqual(728);
  expect(Math.abs((width ?? 0) - (newWidth ?? 0))).toBeLessThan(1);
  await page.screenshot({
    path: testInfo.outputPath("floating-inline-composer.png"),
  });
});
