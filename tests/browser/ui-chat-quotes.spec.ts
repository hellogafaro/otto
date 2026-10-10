import { register } from "./account";
import { expect, test } from "./live-app";

test.use({ launchOptions: { executablePath: process.env.OTTO_TEST_CHROMIUM } });

test("flat quotes preserve drafts, target individual messages and survive reload", async ({
  page,
  fixture,
}, testInfo) => {
  const { workspaceId } = await register(page, fixture, "Quote owner");
  const base = `/api/workspaces/${workspaceId}`;
  const headers = { origin: fixture.origin };
  const response = await page.request.post(`${base}/chats`, {
    headers,
    data: { title: "Launch discussion", visibility: "participants" },
  });
  expect(response.status()).toBe(200);
  const chat = await response.json();
  const originals = [];
  for (const body of [
    "Can we review the launch notes?",
    "The checklist is ready for review.",
  ]) {
    const saved = await page.request.post(`${base}/chats/${chat.id}/messages`, {
      headers,
      data: { body, requestId: crypto.randomUUID() },
    });
    expect(saved.status()).toBe(200);
    originals.push(await saved.json());
  }
  await page.goto(`/chats/${chat.id}`);
  const composer = page.getByRole("group", {
    name: "Message composer",
    exact: true,
  });
  const editor = page.getByLabel("Message Launch discussion, @ to tag");
  await editor.fill("My draft stays here.");
  const messages = page.locator('[data-slot="message-item"]');
  await messages.nth(1).hover();
  await messages
    .nth(1)
    .getByRole("button", { name: "Reply", exact: true })
    .click();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText("My draft stays here.");
  await expect(composer.getByRole("blockquote")).toContainText(
    originals[1].body,
  );
  await composer.getByRole("button", { name: "Remove quote" }).click();
  await expect(composer.getByRole("blockquote")).toHaveCount(0);
  await expect(editor).toHaveText("My draft stays here.");
  await messages.first().hover();
  await messages
    .first()
    .getByRole("button", { name: "Reply", exact: true })
    .click();
  await expect(composer.getByRole("blockquote")).toContainText(
    originals[0].body,
  );
  const editorBox = await editor.boundingBox();
  for (const name of ["Add files", "Send", "Participants"]) {
    const box = await composer
      .getByRole("button", { name, exact: true })
      .boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
      editorBox?.y ?? 0,
    );
  }
  await page.screenshot({ path: testInfo.outputPath("quoted-reply.png") });
  await editor.press("Enter");
  await expect(editor).toBeEmpty();
  await page.reload();
  const savedReply = page
    .locator('[data-slot="message-item"]')
    .filter({ hasText: "My draft stays here." });
  await expect(savedReply.getByRole("blockquote")).toContainText(
    originals[0].body,
  );
  await expect(
    page.getByText(`Reply to message ${originals[0].id}`),
  ).toHaveCount(0);
  const history = await (
    await page.request.get(`${base}/chats/${chat.id}/messages`)
  ).json();
  expect(
    history.find(
      (message: { body: string }) => message.body === "My draft stays here.",
    ).replyTo,
  ).toBe(originals[0].id);
  await page.screenshot({ path: testInfo.outputPath("saved-quote.png") });

  await page.goto("/");
  const floating = page.getByRole("dialog", { name: "Chat", exact: true });
  await floating
    .getByRole("button", { name: "With: Otto", exact: true })
    .click();
  await page.getByRole("option", { name: "Otto", exact: true }).click();
  await page.keyboard.press("Escape");
  const floatingEditor = floating.getByLabel("Message about this page");
  await floatingEditor.fill("A floating conversation.");
  const floatingEditorBox = await floatingEditor.boundingBox();
  const plusBox = await floating
    .getByRole("button", { name: "Add files" })
    .boundingBox();
  expect((plusBox?.y ?? 0) + (plusBox?.height ?? 0)).toBeLessThanOrEqual(
    floatingEditorBox?.y ?? 0,
  );
  await floatingEditor.press("Enter");
  const floatingMessage = floating
    .locator('[data-slot="message-item"]')
    .filter({ hasText: "A floating conversation." });
  await floatingMessage.hover();
  await floatingMessage
    .getByRole("button", { name: "Reply", exact: true })
    .click();
  const floatingComposer = floating.getByRole("group", {
    name: "Message composer",
    exact: true,
  });
  await expect(floatingComposer.getByRole("blockquote")).toContainText(
    "A floating conversation.",
  );
  await floatingComposer
    .locator('[contenteditable="true"]')
    .fill("A flat floating reply.");
  await floatingComposer
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await expect(
    floating
      .locator('[data-slot="message-item"]')
      .filter({ hasText: "A flat floating reply." })
      .getByRole("blockquote"),
  ).toContainText("A floating conversation.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("floating-quote-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
