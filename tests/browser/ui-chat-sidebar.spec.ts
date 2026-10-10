import { register } from "./account";
import { expect, test } from "./live-app";

test.use({ launchOptions: { executablePath: process.env.OTTO_TEST_CHROMIUM } });

test("Chat sidebar keeps participants and shared files without manual Run setup", async ({
  page,
  browser,
  fixture,
}, testInfo) => {
  const { workspaceId } = await register(page, fixture, "Chat owner");
  const base = `/api/workspaces/${workspaceId}`;
  const headers = { origin: fixture.origin };
  const chatResponse = await page.request.post(`${base}/chats`, {
    headers,
    data: { title: "Simple chat", visibility: "participants" },
  });
  expect(chatResponse.status()).toBe(200);
  const chatId = (await chatResponse.json()).id as string;
  const upload = await page.request.put(
    `${base}/files/${crypto.randomUUID()}/content?${new URLSearchParams({
      title: "Shared notes.txt",
      mediaType: "text/plain",
      type: "file",
      visibility: "user",
    })}`,
    { headers, data: Buffer.from("Notes shared in this chat.") },
  );
  expect(upload.status()).toBe(200);
  const file = await upload.json();
  const message = await page.request.post(`${base}/chats/${chatId}/messages`, {
    headers,
    data: {
      body: "Here are the notes.",
      requestId: crypto.randomUUID(),
      fileIds: [file.id],
    },
  });
  expect(message.status()).toBe(200);
  const sessionReads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/sessions"))
      sessionReads.push(request.url());
  });
  await page.goto(`/chats/${chatId}`);
  const panel = page.locator('[data-slot="sidebar"][data-side="right"]');
  await expect(panel).toBeAttached();
  if ((await panel.getAttribute("data-state")) === "collapsed")
    await page
      .locator("main > header")
      .getByRole("button", { name: "Open panel" })
      .click();
  await expect(
    panel.getByRole("button", { name: /^Participants/ }),
  ).toBeVisible();
  await expect(panel.getByText("Chat owner", { exact: true })).toBeVisible();
  await expect(panel.getByText("Library", { exact: true })).toBeVisible();
  await expect(
    panel.getByText("Shared notes.txt", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("link", { name: "Open Library" }),
  ).toHaveAttribute("href", "/library");
  await expect(
    panel.getByRole("button", { name: "Add participants", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Add selected", exact: true }),
  ).toBeHidden();
  await panel
    .getByRole("button", { name: "Add participants", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Add selected", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Add participants", exact: true })
    .click();
  await expect(
    panel.getByText(/^(Project|Visibility|Agent Runs)$/),
  ).toHaveCount(0);
  await expect(panel.getByLabel("Prompt", { exact: true })).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Start Run", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    panel.getByText("Shared notes.txt", { exact: true }),
  ).toBeVisible();
  expect(sessionReads).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("chat-sidebar.png") });

  const readerContext = await browser.newContext({ baseURL: fixture.origin });
  try {
    const readerPage = await readerContext.newPage();
    const reader = await register(readerPage, fixture, "Chat reader", "viewer");
    const added = await page.request.post(
      `${base}/chats/${chatId}/participants`,
      {
        headers,
        data: { userId: reader.userId, role: "viewer" },
      },
    );
    expect(added.status()).toBe(200);
    await readerPage.goto(`/chats/${chatId}`);
    const readerPanel = readerPage.locator(
      '[data-slot="sidebar"][data-side="right"]',
    );
    await expect(readerPanel).toBeAttached();
    if ((await readerPanel.getAttribute("data-state")) === "collapsed")
      await readerPage
        .locator("main > header")
        .getByRole("button", { name: "Open panel" })
        .click();
    await expect(
      readerPanel.getByText("Shared notes.txt", { exact: true }),
    ).toBeVisible();
    await expect(
      readerPanel.getByRole("button", {
        name: "Add participants",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      readerPanel.getByRole("button", { name: /^Remove / }),
    ).toHaveCount(0);
    await expect(
      readerPage.getByText("This chat is read-only for you.", { exact: true }),
    ).toBeVisible();
  } finally {
    await readerContext.close();
  }
});
