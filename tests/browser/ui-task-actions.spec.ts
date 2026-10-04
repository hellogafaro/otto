import type { Page, Route } from "@playwright/test";
import type { InferResponseType } from "hono/client";
import type { workspaceApi } from "../../apps/web/src/lib/api";
import type { startUiApp } from "../fixtures/ui-app";
import { register } from "./account";
import { expect, test } from "./live-app";

type Task = InferResponseType<(typeof workspaceApi.tasks)[":id"]["$get"]>;
type TimePage = InferResponseType<typeof workspaceApi.timesheets.$get>;
type LinkPage = InferResponseType<
  (typeof workspaceApi.tasks)[":id"]["links"]["$get"]
>;

async function readTask(page: Page, url: string): Promise<Task> {
  const response = await page.request.get(url);
  expect(response.status()).toBe(200);
  return response.json();
}

async function openTask(
  page: Page,
  fixture: Awaited<ReturnType<typeof startUiApp>>,
  title: string,
) {
  const { userId, workspaceId } = await register(page, fixture, title);
  const base = `${fixture.origin}/api/workspaces/${workspaceId}`;
  // Set up a real Project through authenticated Hono; Task creation itself uses the UI.
  const project = await page.request.post(`${base}/projects`, {
    headers: { origin: fixture.origin },
    data: { title: `${title} project` },
  });
  expect(project.status()).toBe(200);
  const projectId: string = (await project.json()).id;
  await page.goto(`/tasks?project=${projectId}`);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Message about your tasks",
      exact: true,
    }),
  ).toContainText("Create a task in");
  await expect(
    page.getByRole("dialog", { name: "New task", exact: true }),
  ).toHaveCount(0);
  // Execution needs a configured Agent/account; seed the persisted Task through the real API for detail checks.
  const created = await page.request.post(`${base}/tasks`, {
    headers: { origin: fixture.origin },
    data: { projectId, title, notes: "Original persisted description" },
  });
  expect(created.status()).toBe(200);
  const createdTask: Task = await created.json();
  await page.goto(`/tasks/${createdTask.id}`);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const taskId = new URL(page.url()).pathname.split("/").at(-1);
  expect(taskId).toBeTruthy();
  const taskUrl = `${base}/tasks/${taskId}`;
  const task = await readTask(page, taskUrl);
  expect(task).toMatchObject({
    projectId,
    ownerId: userId,
    title,
    status: "todo",
  });
  await expect(
    page.getByRole("button", { name: "Edit task", exact: true }),
  ).toBeEnabled();
  return { base, taskUrl, task, userId, workspaceId, projectId };
}

async function changeStatus(
  page: Page,
  taskUrl: string,
  from: string,
  to: string,
  status: Task["status"],
) {
  const previous = await readTask(page, taskUrl);
  await page
    .getByRole("button", { name: `Status: ${from}`, exact: true })
    .click();
  const response = page.waitForResponse(
    (value) =>
      value.url() === `${taskUrl}/status` &&
      value.request().method() === "POST",
  );
  await page.getByRole("menuitemradio", { name: new RegExp(to) }).click();
  const ack = await response;
  expect(ack.status()).toBe(200);
  expect(ack.request().postDataJSON()).toEqual({
    status,
    editToken: previous.editToken,
  });
  await expect(
    page.getByRole("button", { name: `Status: ${to}`, exact: true }),
  ).toBeEnabled();
  expect((await readTask(page, taskUrl)).status).toBe(status);
}

async function archive(page: Page, taskUrl: string, archived: boolean) {
  const previous = await readTask(page, taskUrl);
  await page.getByRole("button", { name: "More", exact: true }).click();
  const response = page.waitForResponse(
    (value) =>
      value.url() === `${taskUrl}/archive` &&
      value.request().method() === "POST",
  );
  await page
    .getByRole("menuitem", {
      name: archived ? "Archive" : "Restore",
      exact: true,
    })
    .click();
  const ack = await response;
  expect(ack.status()).toBe(200);
  expect(ack.request().postDataJSON()).toEqual({
    archived,
    editToken: previous.editToken,
  });
  await expect
    .poll(async () => (await readTask(page, taskUrl)).archived)
    .toBe(archived);
  // Wait for the acknowledged cache refresh before the next control captures a token.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(
    page.getByRole("menuitem", {
      name: archived ? "Restore" : "Archive",
      exact: true,
    }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
}

// Hold only the acknowledgement of a real response. Join every handler before
// unregistering: unroute can otherwise handle a released route before fulfill.
async function holdResponse(page: Page, pattern: string, method: string) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let responses = 0;
  const active = new Set<Promise<void>>();
  const handler = (route: Route) => {
    const operation = (async () => {
      if (route.request().method() !== method) return route.continue();
      const response = await route.fetch();
      responses++;
      await held;
      await route.fulfill({ response });
    })();
    const tracked: Promise<void> = operation.finally(() => {
      active.delete(tracked);
    });
    active.add(tracked);
    return tracked;
  };
  await page.route(pattern, handler);
  return {
    async started() {
      await expect.poll(() => responses).toBe(1);
    },
    async finish() {
      release();
      while (active.size) await Promise.all([...active]);
      await page.unroute(pattern, handler);
    },
  };
}

test("Tasks without a Project stay readable during directory loading and on mobile", async ({
  page,
  fixture,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await register(page, fixture, "Empty Tasks owner");
  let taskListReads = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      /\/api\/workspaces\/[^/]+\/tasks$/.test(new URL(request.url()).pathname)
    )
      taskListReads++;
  });
  const projects = "**/api/workspaces/*/projects?*";
  // Controlled read delay: real directory response, with no fake payload or domain outcome.
  const delay = await holdResponse(page, projects, "GET");
  try {
    await page.goto("/tasks");
    await expect(
      page.getByRole("heading", { name: "Tasks", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: "Loading", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Choose a project", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Search tasks", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "New task", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByText("Something went wrong!", { exact: true }),
    ).toHaveCount(0);
    expect(taskListReads).toBe(0);
  } finally {
    await delay.finish();
  }
  await expect(
    page.getByRole("status", { name: "Loading", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("tasks-no-project-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tasks");
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("No tasks yet", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("textbox", {
      name: "Message about your tasks",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("status", { name: "Loading", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Something went wrong!", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(taskListReads).toBe(0);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("tasks-no-project-mobile.png"),
  });
});

test("Task metadata, pending ACK, status, archive and restore persist", async ({
  page,
  fixture,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { taskUrl, task } = await openTask(page, fixture, "Task actions owner");
  let patches = 0;
  page.on("request", (request) => {
    if (request.url() === taskUrl && request.method() === "PATCH") patches++;
  });
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Edit task", exact: true });
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Canceled local draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(patches).toBe(0);
  expect((await readTask(page, taskUrl)).title).toBe(task.title);

  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit task", exact: true });
  await dialog.getByLabel("Title", { exact: true }).fill("Task metadata saved");
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Persisted metadata notes");
  await dialog.getByLabel("Due date", { exact: true }).fill("2026-10-06T09:30");
  const expectedDue = await page.evaluate(() =>
    new Date("2026-10-06T09:30").toISOString(),
  );
  // Controlled ACK delay only: route.fetch executes the actual Hono/DB mutation first.
  const delay = await holdResponse(page, taskUrl, "PATCH");
  try {
    await dialog
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    await delay.started();
    await expect(
      dialog.getByRole("button", { name: "Saving", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByLabel("Title", { exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: task.title,
        exact: true,
        includeHidden: true,
      }),
    ).toBeVisible();
    expect((await readTask(page, taskUrl)).title).toBe("Task metadata saved");
  } finally {
    await delay.finish();
  }
  await expect(dialog).not.toBeVisible();
  expect(patches).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Task metadata saved", exact: true }),
  ).toBeVisible();
  expect(await readTask(page, taskUrl)).toMatchObject({
    title: "Task metadata saved",
    notes: "Persisted metadata notes",
    dueAt: expectedDue,
    ownerId: task.ownerId,
    assigneeUserIds: [],
    assigneeAgentIds: [],
  });
  await changeStatus(page, taskUrl, "Todo", "In progress", "doing");
  await changeStatus(page, taskUrl, "In progress", "Done", "done");
  await changeStatus(page, taskUrl, "Done", "Todo", "todo");
  await archive(page, taskUrl, true);
  await page.reload();
  expect((await readTask(page, taskUrl)).archived).toBe(true);
  await archive(page, taskUrl, false);
  await page.reload();
  expect((await readTask(page, taskUrl)).archived).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("task-actions.png") });
  expect(errors).toEqual([]);
});

test("Task metadata and description recover real 409 without rebasing unsaved drafts", async ({
  page,
  fixture,
}, testInfo) => {
  const { taskUrl } = await openTask(page, fixture, "Task conflict owner");
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Edit task", exact: true });
  const initial = await readTask(page, taskUrl);
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Retained metadata draft");
  // Independent authenticated HTTP write causes a real stale token; no mocked 409 or focus change.
  const winner = await page.request.patch(taskUrl, {
    headers: { origin: fixture.origin },
    data: { title: "Concurrent server winner", editToken: initial.editToken },
  });
  expect(winner.status()).toBe(200);
  const refreshed = page.waitForResponse(
    (response) =>
      response.url() === taskUrl && response.request().method() === "GET",
  );
  const conflict = page.waitForResponse(
    (response) =>
      response.url() === taskUrl && response.request().method() === "PATCH",
  );
  await dialog.getByRole("button", { name: "Save task", exact: true }).click();
  expect((await conflict).status()).toBe(409);
  expect((await refreshed).status()).toBe(200);
  await expect(
    dialog.getByText("Cancel and reopen this editor to use the current task.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
    "Retained metadata draft",
  );
  const repeated = page.waitForResponse(
    (response) =>
      response.url() === taskUrl && response.request().method() === "PATCH",
  );
  await dialog.getByRole("button", { name: "Save task", exact: true }).click();
  const staleAgain = await repeated;
  expect(staleAgain.status()).toBe(409);
  expect(staleAgain.request().postDataJSON().editToken).toBe(initial.editToken);
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit task", exact: true });
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
    "Concurrent server winner",
  );
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Reopened metadata saved");
  await dialog.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await readTask(page, taskUrl)).title).toBe("Reopened metadata saved");

  await page
    .getByRole("button", { name: "Edit description", exact: true })
    .click();
  const editor = page.locator('.otto-editor[contenteditable="true"]');
  await editor.fill("Retained description draft");
  const notesSnapshot = await readTask(page, taskUrl);
  const notesWinner = await page.request.patch(taskUrl, {
    headers: { origin: fixture.origin },
    data: {
      notes: "Concurrent description winner",
      editToken: notesSnapshot.editToken,
    },
  });
  expect(notesWinner.status()).toBe(200);
  const notesRefresh = page.waitForResponse(
    (response) =>
      response.url() === taskUrl && response.request().method() === "GET",
  );
  const notesConflict = page.waitForResponse(
    (response) =>
      response.url() === taskUrl && response.request().method() === "PATCH",
  );
  await page
    .getByRole("button", { name: "Save description", exact: true })
    .click();
  const refused = await notesConflict;
  expect(refused.status()).toBe(409);
  expect(refused.request().postDataJSON().editToken).toBe(
    notesSnapshot.editToken,
  );
  expect((await notesRefresh).status()).toBe(200);
  await expect(editor).toHaveText("Retained description draft");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit description", exact: true })
    .click();
  await expect(editor).toHaveText("Concurrent description winner");
  await editor.fill("Reopened description saved");
  await page
    .getByRole("button", { name: "Save description", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit description", exact: true }),
  ).toBeVisible();
  await page.reload();
  expect((await readTask(page, taskUrl)).notes).toContain(
    "Reopened description saved",
  );
  await expect(
    page.getByText("Reopened description saved", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("task-conflict-recovered.png"),
  });
});

test("Manual timesheets create, correct and delete on Done archived Tasks", async ({
  page,
  fixture,
}, testInfo) => {
  const { base, taskUrl, task, userId } = await openTask(
    page,
    fixture,
    "Task time owner",
  );
  await changeStatus(page, taskUrl, "Todo", "Done", "done");
  await archive(page, taskUrl, true);
  const list = async (): Promise<TimePage> => {
    const response = await page.request.get(
      `${base}/timesheets?taskId=${task.id}&sort=createdAt&order=desc&limit=100`,
    );
    expect(response.status()).toBe(200);
    return response.json();
  };
  await page
    .getByRole("button", { name: "New time entry", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "New time entry",
    exact: true,
  });
  await dialog.getByLabel("Minutes", { exact: true }).fill("25");
  await dialog.getByLabel("Notes", { exact: true }).fill("Canceled time draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await list()).items).toEqual([]);
  await page
    .getByRole("button", { name: "New time entry", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "New time entry", exact: true });
  await dialog.getByLabel("Minutes", { exact: true }).fill("0");
  await expect(
    dialog.getByRole("button", { name: "Save time entry", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Minutes", { exact: true }).fill("1.5");
  await expect(
    dialog.getByRole("button", { name: "Save time entry", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Minutes", { exact: true }).fill("25");
  await dialog.getByLabel("Notes", { exact: true }).fill("Actual manual work");
  await dialog
    .getByRole("button", { name: "Save time entry", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  let entries = (await list()).items;
  expect(entries).toHaveLength(1);
  const original = entries[0];
  expect(original).toMatchObject({
    taskId: task.id,
    duration: 25,
    notes: "Actual manual work",
    createdBy: userId,
  });
  if (!original) throw new Error("Acknowledged time entry missing");
  await page.reload();
  await page
    .getByRole("button", { name: "Edit time entry", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Edit time entry", exact: true });
  await expect(dialog.getByLabel("Minutes", { exact: true })).toHaveValue("25");
  await dialog.getByLabel("Minutes", { exact: true }).fill("40");
  await dialog
    .getByLabel("Notes", { exact: true })
    .fill("Corrected manual work");
  await dialog
    .getByRole("button", { name: "Save time entry", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  entries = (await list()).items;
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    id: original.id,
    duration: 40,
    notes: "Corrected manual work",
    createdBy: userId,
    createdAt: original.createdAt,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Edit time entry", exact: true })
    .hover();
  await page
    .getByRole("button", { name: "Delete time entry", exact: true })
    .click();
  await expect(
    page.getByText("No time entries", { exact: true }),
  ).toBeVisible();
  expect((await list()).items).toEqual([]);
  await page.reload();
  await expect(
    page.getByText("No time entries", { exact: true }),
  ).toBeVisible();
  expect(await readTask(page, taskUrl)).toMatchObject({
    status: "done",
    archived: true,
  });
  await page.screenshot({ path: testInfo.outputPath("task-time-deleted.png") });
});

test("Task URL Document Chat and File links persist, resolve and remove", async ({
  page,
  fixture,
}, testInfo) => {
  const { base, taskUrl, task, projectId } = await openTask(
    page,
    fixture,
    "Task links owner",
  );
  const headers = { origin: fixture.origin };
  const document = await page.request.post(`${base}/documents`, {
    headers,
    data: {
      title: "Task linked document",
      body: "Actual document body",
      projectId,
      visibility: "workspace",
    },
  });
  expect(document.status()).toBe(200);
  const documentId: string = (await document.json()).id;
  const chat = await page.request.post(`${base}/chats`, {
    headers,
    data: { title: "Task linked chat", projectId, visibility: "workspace" },
  });
  expect(chat.status()).toBe(200);
  const chatId: string = (await chat.json()).id;
  // Actual saved bytes through the production bounded small-file endpoint and fixture S3 peer.
  const file = await page.request.post(`${base}/files`, {
    headers,
    data: {
      requestId: crypto.randomUUID(),
      title: "Task linked file.txt",
      type: "file",
      mediaType: "text/plain",
      bytes: Buffer.from("Task linked bytes").toString("base64"),
      projectId,
      visibility: "workspace",
    },
  });
  expect(file.status()).toBe(200);
  const fileId: string = (await file.json()).id;
  const targets = [
    {
      type: "url",
      label: "URL",
      title: "https://example.test/task-reference",
      reference: "https://example.test/task-reference",
      href: "https://example.test/task-reference",
    },
    {
      type: "document",
      label: "Document",
      title: "Task linked document",
      reference: documentId,
      href: `/documents/${documentId}`,
    },
    {
      type: "chat",
      label: "Chat",
      title: "Task linked chat",
      reference: chatId,
      href: `/chats/${chatId}`,
    },
    {
      type: "file",
      label: "File",
      title: "Task linked file.txt",
      reference: fileId,
      href: `/files?open=${fileId}&project=${projectId}`,
    },
  ];
  for (const target of targets) {
    await page.getByRole("button", { name: "New link", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New link", exact: true });
    if (target.type === "url") {
      await dialog.getByLabel("URL", { exact: true }).fill(target.reference);
    } else {
      await dialog
        .getByRole("button", { name: "Link type", exact: true })
        .click();
      await page
        .getByRole("option", { name: target.label, exact: true })
        .click();
      await dialog
        .getByLabel("Search whole words", { exact: true })
        .fill("Task linked");
      await dialog
        .getByRole("button", { name: "Link target", exact: true })
        .click();
      await page
        .getByRole("option", { name: target.title, exact: true })
        .click();
    }
    await dialog.getByRole("button", { name: "Add link", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("link", { name: target.title, exact: true }),
    ).toHaveAttribute("href", target.href);
  }
  await page.reload();
  const response = await page.request.get(
    `${taskUrl}/links?sort=type&limit=100`,
  );
  expect(response.status()).toBe(200);
  const links: LinkPage = await response.json();
  expect(links.items).toHaveLength(4);
  for (const target of targets) {
    expect(links.items).toContainEqual(
      expect.objectContaining({
        type: target.type,
        reference: target.reference,
      }),
    );
    await expect(
      page.getByRole("link", { name: target.title, exact: true }),
    ).toHaveAttribute("href", target.href);
  }
  await page.screenshot({ path: testInfo.outputPath("task-real-links.png") });
  for (const target of targets) {
    const row = page.locator('[data-slot="sidebar-menu-item"]').filter({
      has: page.getByRole("link", { name: target.title, exact: true }),
    });
    await row.hover();
    await row
      .getByRole("button", { name: "Remove task link", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: target.title, exact: true }),
    ).toHaveCount(0);
  }
  await page.reload();
  await expect(page.getByText("No links", { exact: true })).toBeVisible();
  const remainingResponse = await page.request.get(
    `${taskUrl}/links?sort=type&limit=100`,
  );
  expect(remainingResponse.status()).toBe(200);
  const remaining: LinkPage = await remainingResponse.json();
  expect(remaining.items).toEqual([]);
  expect((await readTask(page, taskUrl)).id).toBe(task.id);
});

test("Task status shortcut does not open or mutate beneath metadata link or time dialogs", async ({
  page,
  fixture,
}, testInfo) => {
  const { taskUrl } = await openTask(page, fixture, "Task modal owner");
  const initial = await readTask(page, taskUrl);
  let statusWrites = 0;
  page.on("request", (request) => {
    if (request.url() === `${taskUrl}/status` && request.method() === "POST")
      statusWrites++;
  });
  for (const control of [
    { button: "Edit task", dialog: "Edit task" },
    { button: "New link", dialog: "New link" },
    { button: "New time entry", dialog: "New time entry" },
  ]) {
    await test.step(control.dialog, async () => {
      await page
        .getByRole("button", { name: control.button, exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: control.dialog,
        exact: true,
      });
      const cancel = dialog.getByRole("button", {
        name: "Cancel",
        exact: true,
      });
      // Button focus exercises the shared modal guard rather than the text-input typing guard.
      await cancel.focus();
      await page.keyboard.press("s");
      await expect(page.locator('[role="menu"]')).toHaveCount(0);
      await page.keyboard.press("3");
      await expect(dialog).toBeVisible();
      expect(statusWrites).toBe(0);
      expect(await readTask(page, taskUrl)).toMatchObject({
        status: "todo",
        editToken: initial.editToken,
      });
      await cancel.click();
    });
  }
  await page.screenshot({
    path: testInfo.outputPath("task-modal-shortcut.png"),
  });
});
