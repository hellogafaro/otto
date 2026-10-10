import { register } from "./account";
import { expect, test } from "./live-app";

test.use({ launchOptions: { executablePath: process.env.OTTO_TEST_CHROMIUM } });

test("one sidebar keeps authorized mixed history, pins, attention and a real Chats list", async ({
  page,
  fixture,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { userId, workspaceId } = await register(
    page,
    fixture,
    "Navigation owner",
  );
  const base = `/api/workspaces/${workspaceId}`;
  const headers = { origin: fixture.origin };
  const firstResponse = await page.request.post(`${base}/chats`, {
    headers,
    data: { title: "Pinned conversation", visibility: "participants" },
  });
  expect(firstResponse.status()).toBe(200);
  const first = await firstResponse.json();
  const secondResponse = await page.request.post(`${base}/chats`, {
    headers,
    data: { title: "Needs a reply", visibility: "participants" },
  });
  expect(secondResponse.status()).toBe(200);
  const second = await secondResponse.json();
  const projectResponse = await page.request.post(`${base}/projects`, {
    headers,
    data: { title: "Navigation project" },
  });
  expect(projectResponse.status()).toBe(200);
  const project = await projectResponse.json();
  const taskResponse = await page.request.post(`${base}/tasks`, {
    headers,
    data: { projectId: project.id, title: "Navigation task" },
  });
  expect(taskResponse.status()).toBe(200);
  const task = await taskResponse.json();

  await page.goto("/chats");
  const list = page.getByRole("list", { name: "Chats list" });
  await expect(
    list.getByRole("link", { name: /Pinned conversation/ }),
  ).toBeVisible();
  await expect(list.getByRole("link", { name: /Needs a reply/ })).toBeVisible();
  await expect(page).toHaveURL(/\/chats(?:\?|$)/);
  await expect(
    page.locator('[data-slot="sidebar"][data-side="left"]'),
  ).toHaveCount(1);
  await list
    .getByRole("button", { name: "Actions for Pinned conversation" })
    .click();
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  const pins = page.getByRole("group", { name: "Pins", exact: true });
  const recents = page.getByRole("group", { name: "Recents", exact: true });
  await expect(
    pins.getByRole("link", { name: "Pinned conversation", exact: true }),
  ).toBeVisible();
  await list.getByRole("link", { name: /Pinned conversation/ }).click();
  await expect(page).toHaveURL(`/chats/${first.id}`);
  await page.goto(`/projects/${project.id}`);
  await expect(
    recents.getByRole("link", { name: "Navigation project", exact: true }),
  ).toBeVisible();
  await page.goto(`/tasks/${task.id}`);
  await expect(
    recents.getByRole("link", { name: "Navigation task", exact: true }),
  ).toBeVisible();
  const message = await page.request.post(
    `${base}/chats/${second.id}/messages`,
    {
      headers,
      data: { body: "Unread navigation proof", requestId: crypto.randomUUID() },
    },
  );
  expect(message.status()).toBe(200);
  await page.goto("/chats");
  await expect(
    recents.getByRole("link", { name: /Needs a reply/ }),
  ).toBeVisible();
  await expect(recents.getByRole("link").first()).toContainText(
    "Needs a reply",
  );
  await expect(
    recents.getByRole("img", { name: "Unread", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    pins.getByRole("link", { name: "Pinned conversation", exact: true }),
  ).toBeVisible();
  await expect(
    recents.getByRole("link", { name: "Navigation project", exact: true }),
  ).toBeVisible();
  await expect(
    recents.getByRole("link", { name: "Navigation task", exact: true }),
  ).toBeVisible();
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    `otto-navigation:${userId}:${workspaceId}`,
  );
  expect(stored).not.toContain("Pinned conversation");
  expect(stored).not.toContain("Navigation project");
  expect(stored).not.toContain("Navigation task");
  const parsed = JSON.parse(stored ?? "null");
  expect(parsed.pins).toEqual([{ type: "chat", id: first.id }]);
  expect(parsed.recents.length).toBeLessThanOrEqual(20);
  await page.screenshot({
    path: testInfo.outputPath("navigation-chats-light.png"),
    animations: "disabled",
  });

  await page
    .getByRole("button", { name: "Search", exact: true })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog").getByPlaceholder("Search"),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page
    .getByRole("textbox", { name: "Search chats", exact: true })
    .fill("Needs a reply");
  await page
    .getByRole("form", { name: "Chat search" })
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await expect(
    list.getByRole("link", { name: /Pinned conversation/ }),
  ).toHaveCount(0);
  await expect(list.getByRole("link", { name: /Needs a reply/ })).toBeVisible();
  await page
    .getByRole("navigation", { name: "App navigation" })
    .getByRole("link", { name: "Chats", exact: true })
    .click();
  await expect(page).toHaveURL(/\/chats(?:\?|$)/);
  await page
    .getByRole("button", { name: "Collapse navigation", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "App navigation" }),
  ).not.toBeInViewport();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "App navigation" }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Settings navigation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "App navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Pins", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("navigation-settings.png"),
    animations: "disabled",
  });
  await page.getByRole("link", { name: "Back to Home", exact: true }).click();
  await expect(page).toHaveURL("/");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/chats");
  await page.screenshot({
    path: testInfo.outputPath("navigation-chats-dark.png"),
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("navigation", { name: "App navigation" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  const mobileNavigation = page.getByRole("navigation", {
    name: "App navigation",
  });
  await expect(mobileNavigation).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("navigation-mobile-open.png"),
    animations: "disabled",
  });
  await mobileNavigation
    .getByRole("link", { name: "Projects", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects(?:\?|$)/);
  await expect(mobileNavigation).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(mobileNavigation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(mobileNavigation).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("navigation-mobile-closed.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await pins
    .getByRole("button", {
      name: "Navigation actions for Pinned conversation",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Unpin", exact: true }).click();
  await expect(
    pins.getByRole("link", { name: "Pinned conversation", exact: true }),
  ).toHaveCount(0);
  await recents
    .getByRole("button", {
      name: "Navigation actions for Navigation project",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Remove from recents", exact: true })
    .click();
  await expect(
    recents.getByRole("link", { name: "Navigation project", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    pins.getByRole("link", { name: "Pinned conversation", exact: true }),
  ).toHaveCount(0);
  await expect(
    recents.getByRole("link", { name: "Navigation project", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("saved navigation never renders inaccessible titles and stays scoped to the workspace", async ({
  page,
  fixture,
  browser,
}) => {
  const { userId, workspaceId } = await register(
    page,
    fixture,
    "Navigation privacy owner",
  );
  const base = `/api/workspaces/${workspaceId}`;
  const headers = { origin: fixture.origin };
  const created = await page.request.post(`${base}/chats`, {
    headers,
    data: { title: "Private navigation title", visibility: "participants" },
  });
  expect(created.status()).toBe(200);
  const chat = await created.json();
  const viewer = await browser.newContext({ baseURL: fixture.origin });
  try {
    const viewerPage = await viewer.newPage();
    const reader = await register(
      viewerPage,
      fixture,
      "Navigation viewer",
      "viewer",
    );
    await viewerPage.evaluate(
      ({ key, id }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            pins: [{ type: "chat", id, title: "Poisoned saved title" }],
            recents: [{ type: "chat", id }],
          }),
        );
      },
      { key: `otto-navigation:${reader.userId}:${workspaceId}`, id: chat.id },
    );
    await viewerPage.goto("/chats");
    await expect(
      viewerPage.getByText("Poisoned saved title", { exact: true }),
    ).toHaveCount(0);
    await expect(
      viewerPage.getByText("Private navigation title", { exact: true }),
    ).toHaveCount(0);
    await expect(
      viewerPage.getByRole("button", { name: "New chat", exact: true }),
    ).toHaveCount(0);
    const added = await page.request.post(
      `${base}/chats/${chat.id}/participants`,
      { headers, data: { userId: reader.userId, role: "viewer" } },
    );
    expect(added.status()).toBe(200);
    await viewerPage.reload();
    const viewerPins = viewerPage.getByRole("group", {
      name: "Pins",
      exact: true,
    });
    await expect(
      viewerPins.getByRole("link", {
        name: "Private navigation title",
        exact: true,
      }),
    ).toBeVisible();
    const participantsResponse = await page.request.get(
      `${base}/chats/${chat.id}/participants`,
    );
    expect(participantsResponse.status()).toBe(200);
    const participants: { items: { id: string; userId: string | null }[] } =
      await participantsResponse.json();
    const participant = participants.items.find(
      (item) => item.userId === reader.userId,
    );
    expect(participant).toBeTruthy();
    const revoked = await page.request.delete(
      `${base}/chats/${chat.id}/participants/${participant?.id}`,
      { headers },
    );
    expect(revoked.status()).toBe(200);
    await expect(
      viewerPage.getByText("Private navigation title", { exact: true }),
    ).toHaveCount(0, { timeout: 15000 });
    await viewerPage.reload();
    await expect(
      viewerPage.getByText("Private navigation title", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await viewer.close();
  }
  await page.goto(`/chats/${chat.id}`);
  await expect(
    page
      .getByRole("group", { name: "Recents", exact: true })
      .getByRole("link", { name: "Private navigation title", exact: true }),
  ).toBeVisible();
  const second = await fixture.secondWorkspace(userId);
  await page.evaluate(
    (id) => localStorage.setItem("otto-workspace", id),
    second,
  );
  await page.reload();
  await expect(
    page.getByText("Private navigation title", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(
    (id) => localStorage.setItem("otto-workspace", id),
    workspaceId,
  );
  await page.goto("/chats");
  await expect(
    page
      .getByRole("group", { name: "Recents", exact: true })
      .getByRole("link", { name: "Private navigation title", exact: true }),
  ).toBeVisible();
});
