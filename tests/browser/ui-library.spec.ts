import { register } from "./account";
import { expect, test } from "./live-app";

test.use({ launchOptions: { executablePath: process.env.OTTO_TEST_CHROMIUM } });

test("Library combines saved documents and uploads with compact type tabs and clean Home cards", async ({
  page,
  fixture,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { workspaceId } = await register(page, fixture, "Library reviewer");
  const base = `/api/workspaces/${workspaceId}`;
  const headers = { origin: new URL(page.url()).origin };
  const chat = await page.request.post(`${base}/chats`, {
    headers,
    data: { title: "Library discussion", visibility: "workspace" },
  });
  expect(chat.status()).toBe(200);
  await page.reload();
  await expect(
    page.getByText("Library discussion", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".home-card [data-slot=empty-title]")).toHaveCount(
    0,
  );
  await expect(page.locator(".home-card button")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "All chats", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Home task project")).toHaveCount(0);
  await expect(page.locator(".home-section > header > *")).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath("home-simple.png") });

  const rail = page.getByRole("navigation", { name: "App navigation" });
  await expect(
    rail.getByRole("button", { name: "Library", exact: true }),
  ).toHaveCount(1);
  await expect(
    rail.getByRole("button", { name: "Files", exact: true }),
  ).toHaveCount(0);
  await expect(
    rail.getByRole("button", { name: "Documents", exact: true }),
  ).toHaveCount(0);
  await rail.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  await (await chooser).setFiles({
    name: "Pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();

  for (const [title, mediaType] of [
    ["Brief.pdf", "application/pdf"],
    ["Clip.mp4", "video/mp4"],
    ["Sound.wav", "audio/wav"],
    ["Archive.zip", "application/zip"],
  ] as const) {
    const query = new URLSearchParams({
      title,
      mediaType,
      type: "file",
      visibility: "user",
    });
    const result = await page.request.put(
      `${base}/files/${crypto.randomUUID()}/content?${query}`,
      {
        headers: { ...headers, "content-type": "application/octet-stream" },
        data: Buffer.from(`Controlled ${title} bytes`),
      },
    );
    expect(result.status()).toBe(200);
  }
  const project = await page.request.post(`${base}/projects`, {
    headers,
    data: { title: "Library project" },
  });
  expect(project.status()).toBe(200);
  const projectId = (await project.json()).id;
  const document = await page.request.post(`${base}/documents`, {
    headers,
    data: {
      title: "Project notes",
      body: "Persisted Library document",
      projectId,
      visibility: "user",
    },
  });
  expect(document.status()).toBe(200);
  const documentId = (await document.json()).id;
  await page.reload();
  const tabs = page.getByRole("tablist", { name: "Library types" });
  await expect(tabs.getByRole("tab")).toHaveText([
    "All",
    "Documents",
    "Images",
    "Video",
    "Audio",
    "Other",
  ]);
  expect(
    (await tabs.getByRole("tab", { name: "All", exact: true }).boundingBox())
      ?.height,
  ).toBe(28);
  await expect(page.getByText("Project notes", { exact: true })).toBeVisible();
  await expect(page.getByText("Pixel.png", { exact: true })).toBeVisible();
  const addAction = page.getByRole("button", { name: "Add", exact: true });
  await expect(addAction.locator("xpath=ancestor::header")).toHaveCSS(
    "padding",
    "8px",
  );
  expect(
    await addAction.evaluate((button) => {
      const heading = button.ownerDocument.querySelector("h1");
      return Boolean(
        heading &&
          button.getBoundingClientRect().top <
            heading.getBoundingClientRect().top,
      );
    }),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("library-all.png") });
  const checks = [
    ["Documents", ["Project notes", "Brief.pdf"]],
    ["Images", ["Pixel.png"]],
    ["Video", ["Clip.mp4"]],
    ["Audio", ["Sound.wav"]],
    ["Other", ["Archive.zip"]],
  ] as const;
  const titles = [
    "Project notes",
    "Brief.pdf",
    "Pixel.png",
    "Clip.mp4",
    "Sound.wav",
    "Archive.zip",
  ];
  for (const [tab, visible] of checks) {
    await tabs.getByRole("tab", { name: tab, exact: true }).click();
    await expect(
      tabs.getByRole("tab", { name: tab, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    for (const title of titles) {
      const item = page.getByText(title, { exact: true });
      if ((visible as readonly string[]).includes(title))
        await expect(item).toBeVisible();
      else await expect(item).toHaveCount(0);
    }
  }
  await page.reload();
  await expect(
    tabs.getByRole("tab", { name: "Other", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goto("/documents");
  await expect(page).toHaveURL(/\/library\?category=documents$/);
  await page.getByText("Project notes", { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/library/documents/${documentId}$`));
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Project notes");
  await page.goto(`/documents/${documentId}`);
  await expect(page).toHaveURL(new RegExp(`/library/documents/${documentId}$`));
  await page.goto("/files");
  await expect(page).toHaveURL(/\/library$/);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "New document", exact: true })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Created in Library");
  await page
    .getByLabel("Body", { exact: true })
    .fill("Saved through the existing document editor.");
  await page
    .getByRole("button", { name: "Create document", exact: true })
    .click();
  await expect(page).toHaveURL(/\/library\/documents\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Created in Library");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Created in Library");
  expect(errors).toEqual([]);
});

test("Home shows real owner comments and mentions with padded panel headers", async ({
  page,
  browser,
  fixture,
}, testInfo) => {
  const owner = await register(page, fixture, "Notification owner");
  const base = `/api/workspaces/${owner.workspaceId}`;
  const headers = { origin: new URL(page.url()).origin };
  const context = await browser.newContext({ baseURL: fixture.origin });
  const colleaguePage = await context.newPage();
  try {
    const colleague = await register(
      colleaguePage,
      fixture,
      "Comment author",
      "owner",
    );
    const projectResponse = await page.request.post(`${base}/projects`, {
      headers,
      data: { title: "Notification project" },
    });
    expect(projectResponse.status()).toBe(200);
    const project = await projectResponse.json();
    expect(
      (
        await page.request.post(`${base}/projects/${project.id}/members`, {
          headers,
          data: { userId: colleague.userId, role: "contributor" },
        })
      ).status(),
    ).toBe(200);
    const ownedResponse = await page.request.post(`${base}/tasks`, {
      headers,
      data: { projectId: project.id, title: "Owned task" },
    });
    const mentionedResponse = await colleaguePage.request.post(
      `${base}/tasks`,
      {
        headers,
        data: { projectId: project.id, title: "Mentioned task" },
      },
    );
    expect(ownedResponse.status()).toBe(200);
    expect(mentionedResponse.status()).toBe(200);
    const owned = await ownedResponse.json();
    const mentioned = await mentionedResponse.json();
    for (const [taskId, body] of [
      [owned.id, "Please review the saved design."],
      [mentioned.id, `Question for @[Owner \\[QA\\]](user:${owner.userId}).`],
      [mentioned.id, "Unrelated discussion."],
    ]) {
      expect(
        (
          await colleaguePage.request.post(`${base}/task-comments`, {
            headers,
            data: { taskId, body },
          })
        ).status(),
      ).toBe(200);
    }
    expect(
      (
        await page.request.post(`${base}/task-comments`, {
          headers,
          data: { taskId: owned.id, body: "My own reply." },
        })
      ).status(),
    ).toBe(200);
    const restrictedResponse = await colleaguePage.request.post(
      `${base}/projects`,
      {
        headers,
        data: { title: "Private notification project" },
      },
    );
    expect(restrictedResponse.status()).toBe(200);
    const restricted = await restrictedResponse.json();
    const privateResponse = await colleaguePage.request.post(`${base}/tasks`, {
      headers,
      data: { projectId: restricted.id, title: "Private mention" },
    });
    expect(privateResponse.status()).toBe(200);
    const privateTask = await privateResponse.json();
    expect(
      (
        await colleaguePage.request.post(`${base}/task-comments`, {
          headers,
          data: {
            taskId: privateTask.id,
            body: `@[Owner](user:${owner.userId}) private comment`,
          },
        })
      ).status(),
    ).toBe(200);
    const notifications = await page.request.get(
      `${base}/task-notifications?limit=1`,
    );
    expect(notifications.status()).toBe(200);
    const first = await notifications.json();
    expect(first.items).toHaveLength(1);
    expect(first.items[0].mentioned).toBe(true);
    expect(first.next).toBeTruthy();
    const second = await page.request.get(
      `${base}/task-notifications?limit=1&after=${encodeURIComponent(first.next)}`,
    );
    expect(second.status()).toBe(200);
    expect((await second.json()).items[0].taskId).toBe(owned.id);
    expect(
      (
        await colleaguePage.request.get(
          `${base}/task-notifications?after=${encodeURIComponent(first.next)}`,
        )
      ).status(),
    ).toBe(400);
    await page.goto("/");
    const card = page.getByRole("region", {
      name: "Notifications",
      exact: true,
    });
    await expect(card.getByText("Owned task", { exact: true })).toBeVisible();
    await expect(
      card.getByText("Mentioned task", { exact: true }),
    ).toBeVisible();
    await expect(card.getByText("Unrelated discussion.")).toHaveCount(0);
    await expect(card.getByText("My own reply.")).toHaveCount(0);
    await expect(card.getByText("Private mention")).toHaveCount(0);
    await page.reload();
    await expect(
      card.getByText("Please review the saved design.", { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("home-notifications.png"),
    });
    await card.getByText("Owned task", { exact: true }).click();
    const close = page.getByRole("button", {
      name: "Close panel",
      exact: true,
    });
    await expect(close).toBeVisible();
    await expect(close.locator("xpath=ancestor::header")).toHaveCSS(
      "padding",
      "8px",
    );
    await close.click();
    const open = page
      .locator("main > header")
      .getByRole("button", { name: "Open panel", exact: true });
    await expect(open).toBeVisible();
    await expect(open.locator("xpath=ancestor::header")).toHaveCSS(
      "padding",
      "8px",
    );
    await open.click();
    await page.screenshot({ path: testInfo.outputPath("panel-headers.png") });
    await page.goto("/library");
    await page
      .getByRole("button", { name: "New document", exact: true })
      .click();
    await page
      .getByLabel("Title", { exact: true })
      .fill("First Library document");
    await page
      .getByLabel("Body", { exact: true })
      .fill("Created without an upload or model.");
    await page
      .getByRole("button", { name: "Create document", exact: true })
      .click();
    await expect(page).toHaveURL(/\/library\/documents\/[0-9a-f-]+$/);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Title", exact: true }),
    ).toHaveValue("First Library document");
  } finally {
    await context.close();
  }
});
