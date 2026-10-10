import { createAgent } from "../../packages/agents/src";
import { createChat, createParticipant } from "../../packages/chats/src";
import { createTask, getTask } from "../../packages/tasks/src";
import { getTaskComments } from "../../packages/tasks/src/comments";
import { submitTaskReview } from "../../packages/tasks/src/review";
import { inWorkspace } from "../../packages/workspaces/src";
import { register } from "./account";
import { expect, test } from "./live-app";

test("five stages and human review persist after an uncertain acknowledgement and reload", async ({
  page,
  fixture,
}, testInfo) => {
  const { userId, workspaceId } = await register(
    page,
    fixture,
    "Task review owner",
  );
  const base = `${fixture.origin}/api/workspaces/${workspaceId}`;
  const createdProject = await page.request.post(`${base}/projects`, {
    headers: { origin: fixture.origin },
    data: { title: "Task review fixture" },
  });
  expect(createdProject.status()).toBe(200);
  const projectId: string = (await createdProject.json()).id;
  const setup = await inWorkspace(
    fixture.database.db,
    workspaceId,
    { userId },
    async (c) => {
      const agent = await createAgent(c, {
        title: "Review worker",
        projectId,
        instructions: "Fixture worker",
        model: "openai/gpt-4.1-mini",
      });
      const chat = await createChat(c, {
        title: "Original work chat",
        projectId,
        visibility: "workspace",
      });
      await createParticipant(c, chat.id, {
        agentId: agent.id,
        role: "contributor",
      });
      const task = await createTask(c, {
        projectId,
        title: "Inspect completed work",
        assigneeAgentIds: [agent.id],
      });
      return { agent, chat, task };
    },
  );
  await inWorkspace(
    fixture.database.db,
    workspaceId,
    { userId, agentId: setup.agent.id },
    (c) =>
      submitTaskReview(c, setup.task.id, {
        editToken: setup.task.editToken,
        body: "Finished the implementation. Evidence: https://example.com/test-result",
        chatId: setup.chat.id,
      }),
  );
  await page.goto(`/tasks?project=${projectId}`);
  for (const stage of [
    "Backlog",
    "Pending",
    "In progress",
    "In review",
    "Completed",
  ]) {
    await expect(
      page.getByRole("button", { name: new RegExp(`^${stage} \\d+$`) }),
    ).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("five-task-stages.png") });
  await page.goto(`/tasks/${setup.task.id}`);
  const card = page.locator('[aria-label="Task review"]');
  await expect(
    card.getByText("Finished the implementation.", { exact: false }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Open work chat", exact: true }),
  ).toHaveAttribute("href", `/chats/${setup.chat.id}`);
  await expect(
    card.getByRole("button", { name: "Request changes", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("task-review-controls.png"),
  });
  let lost = false;
  const requests: unknown[] = [];
  await page.route(
    `**/api/workspaces/${workspaceId}/tasks/${setup.task.id}/review`,
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      requests.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (!lost) {
        lost = true;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "unavailable" }),
        });
      }
      return route.fulfill({ response });
    },
  );
  await card.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Retry decision", exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Retry decision", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  const result = await inWorkspace(
    fixture.database.db,
    workspaceId,
    { userId },
    async (c) => ({
      task: await getTask(c, setup.task.id),
      comments: await getTaskComments(c, { taskId: setup.task.id }),
    }),
    false,
    fixture.cursors,
  );
  expect(result.task.status).toBe("done");
  expect(result.comments.items).toHaveLength(2);
  expect(
    result.comments.items.filter((item) => item.body === "Approved"),
  ).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Status: Completed", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Task activity" })
      .getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Task activity" })
      .getByRole("button", { name: "Delete", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("completed-task-after-reload.png"),
  });
});

test("request changes saves feedback and retains the original work chat without a second chat", async ({
  page,
  fixture,
}, testInfo) => {
  const { userId, workspaceId } = await register(
    page,
    fixture,
    "Change request owner",
  );
  const base = `${fixture.origin}/api/workspaces/${workspaceId}`;
  const project = await page.request.post(`${base}/projects`, {
    headers: { origin: fixture.origin },
    data: { title: "Requested changes" },
  });
  expect(project.status()).toBe(200);
  const projectId: string = (await project.json()).id;
  const setup = await inWorkspace(
    fixture.database.db,
    workspaceId,
    { userId },
    async (c) => {
      const agent = await createAgent(c, {
        title: "Change worker",
        projectId,
        instructions: "Fixture worker",
        model: "openai/gpt-4.1-mini",
      });
      const chat = await createChat(c, {
        title: "One source chat",
        projectId,
        visibility: "workspace",
      });
      await createParticipant(c, chat.id, {
        agentId: agent.id,
        role: "contributor",
      });
      const task = await createTask(c, {
        title: "Add remaining evidence",
        projectId,
        assigneeAgentIds: [agent.id],
      });
      return { agent, chat, task };
    },
  );
  await inWorkspace(
    fixture.database.db,
    workspaceId,
    { userId, agentId: setup.agent.id },
    (c) =>
      submitTaskReview(c, setup.task.id, {
        editToken: setup.task.editToken,
        body: "Ready for review; fixture evidence is attached in this source chat.",
        chatId: setup.chat.id,
      }),
  );
  await page.goto(`/tasks/${setup.task.id}`);
  const card = page.locator('[aria-label="Task review"]');
  await card
    .getByLabel("Requested changes", { exact: true })
    .fill("Please show the reload proof.");
  await card
    .getByRole("button", { name: "Request changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Status: In progress", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Changes requested", { exact: false }).first(),
  ).toBeVisible();
  await expect(card.getByRole("alert")).toContainText(
    "worker was not notified",
  );
  await expect(
    card.getByRole("button", { name: "Retry decision", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page
      .locator('[aria-label="Task review"]')
      .getByRole("button", { name: "Retry decision", exact: true }),
  ).toBeEnabled();
  const response = await page.request.get(`${base}/tasks/${setup.task.id}`);
  expect(response.status()).toBe(200);
  expect((await response.json()).status).toBe("doing");
  const links = await page.request.get(`${base}/tasks/${setup.task.id}/links`);
  expect(links.status()).toBe(200);
  expect((await links.json()).items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "chat", reference: setup.chat.id }),
    ]),
  );
  const chats = await page.request.get(`${base}/chats?projectId=${projectId}`);
  expect(chats.status()).toBe(200);
  expect((await chats.json()).items).toHaveLength(1);
  await expect(
    page.getByText("Please show the reload proof.", { exact: false }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("requested-changes-after-reload.png"),
  });
});
