import type { Locator, Page } from "@playwright/test";
import type { hc, InferRequestType, InferResponseType } from "hono/client";
import type { RpcApp } from "../../apps/server/src/api";
import { register } from "./account";
import { expect, test } from "./live-app";

type WorkspaceApi = ReturnType<typeof hc<RpcApp>>["workspaces"][":workspaceId"];
type Agent = InferResponseType<WorkspaceApi["agents"][":id"]["$get"]>;
type Skill = InferResponseType<WorkspaceApi["skills"][":id"]["$get"]>;
type Schedule = InferResponseType<WorkspaceApi["schedules"][":id"]["$get"]>;
type Chat = InferResponseType<WorkspaceApi["chats"][":id"]["$get"]>;

const unique = (prefix: string) => `${prefix} ${crypto.randomUUID()}`;
const path = (workspaceId: string, domain: string, id?: string) =>
  `/api/workspaces/${workspaceId}/${domain}${id ? `/${id}` : ""}`;
const headers = (page: Page) => ({ origin: new URL(page.url()).origin });

async function getAgent(page: Page, workspaceId: string, id: string) {
  const response = await page.request.get(path(workspaceId, "agents", id));
  expect(response.status()).toBe(200);
  return (await response.json()) as Agent;
}
async function getSkill(page: Page, workspaceId: string, id: string) {
  const response = await page.request.get(path(workspaceId, "skills", id));
  expect(response.status()).toBe(200);
  return (await response.json()) as Skill;
}
async function getSchedule(page: Page, workspaceId: string, id: string) {
  const response = await page.request.get(path(workspaceId, "schedules", id));
  expect(response.status()).toBe(200);
  return (await response.json()) as Schedule;
}

// Setup calls use the registered human's real Hono session, not database inserts.
async function seedAgent(page: Page, workspaceId: string, title: string) {
  const data = {
    title,
    instructions: `Instructions for ${title}`,
    visibility: "workspace",
    model: "qa-explicit-script-model",
  } satisfies InferRequestType<WorkspaceApi["agents"]["$post"]>["json"];
  const response = await page.request.post(path(workspaceId, "agents"), {
    headers: headers(page),
    data,
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { agent: Agent }).agent;
}
async function seedChat(page: Page, workspaceId: string, title: string) {
  const response = await page.request.post(path(workspaceId, "chats"), {
    headers: headers(page),
    data: { title, visibility: "workspace" } satisfies InferRequestType<
      WorkspaceApi["chats"]["$post"]
    >["json"],
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Chat;
}

async function choose(
  page: Page,
  container: Page | Locator,
  label: string,
  value: string,
) {
  await container
    .getByRole("button", { name: new RegExp(`^${label}:`) })
    .click();
  await page.getByRole("menuitemradio", { name: value, exact: true }).click();
}
async function more(page: Page, action: string) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
async function openSkill(page: Page, title: string, archived = false) {
  await page
    .locator('[data-slot="item"]')
    .filter({ has: page.getByText(title, { exact: true }) })
    .getByRole("button", {
      name: archived ? "View archived skill" : "Open skill",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Skill", exact: true });
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(title);
  return dialog;
}
async function closeSkill(dialog: Locator) {
  // A saved database value can be observed before mutation ACK/invalidation
  // settles. Wait for the editor to unlock before testing the stock Close.
  const save = dialog.getByRole("button", {
    name: "Save instructions",
    exact: true,
  });
  if (await save.count()) await expect(save).toBeEnabled();
  else
    await expect(
      dialog.getByRole("button", { name: "Export SKILL.md", exact: true }),
    ).toBeEnabled();
  await dialog.locator('[data-slot="dialog-close"]').click();
  await expect(dialog).not.toBeVisible();
}
async function prepareAgent(page: Page, title: string) {
  await page.goto("/settings/agents");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New agent", exact: true });
  await dialog.getByRole("textbox", { name: "Agent title" }).fill(title);
  await dialog
    .getByRole("textbox", { name: "Agent instructions" })
    .fill(`Private instructions for ${title}`);
  await dialog
    .getByRole("textbox", { name: "Configured model ID" })
    .fill("qa-explicit-script-model");
  return dialog;
}
async function prepareSkill(page: Page, agentId: string, title: string) {
  await page.goto(`/settings/agents/${agentId}`);
  await page.getByRole("button", { name: "New skill", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New skill", exact: true });
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("Instructions", { exact: true }).fill(`Use ${title}`);
  await dialog
    .getByLabel("When to use", { exact: true })
    .fill("For QA requests");
  return dialog;
}
async function prepareSchedule(
  page: Page,
  title: string,
  agent: Agent,
  chat: Chat,
) {
  await page.goto("/schedules");
  await page
    .getByRole("button", { name: "New schedule", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "New schedule",
    exact: true,
  });
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog
    .getByLabel("Prompt", { exact: true })
    .fill(`Private body ${title}`);
  // Required destination and Agent are real selected IDs; no default fixed Agent.
  await expect(
    dialog.getByRole("button", { name: "Save schedule" }),
  ).toBeDisabled();
  await dialog.getByLabel("Agent", { exact: true }).fill(agent.title);
  await choose(page, dialog, "Agent", agent.title);
  await dialog.getByLabel("Output Chat", { exact: true }).fill(chat.title);
  await choose(page, dialog, "Output Chat", chat.title);
  await expect(
    dialog.getByRole("button", { name: "Save schedule" }),
  ).toBeEnabled();
  return dialog;
}

function recordPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

// Production QueryClient refetches on the browser visibility event. Dispatching
// it exercises cached readback after a real permission change without replacing
// HTTP responses or exposing/modifying the client cache.
async function refetchDenied(page: Page, resourcePath: string) {
  const denied = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === resourcePath &&
      [403, 404].includes(response.status()),
  );
  // Advance only browser cache age beyond the production 10s staleTime.
  const now = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(new Date(now + 10_001));
  await page.bringToFront();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await denied;
}

test("Agent UI saves explicit configuration, rejects a stale draft and archives/restores", async ({
  page,
  fixture,
}) => {
  const errors = recordPageErrors(page);
  const { workspaceId, userId } = await register(
    page,
    fixture,
    "Agent QA Owner",
  );
  const title = unique("Agent lifecycle");
  const dialog = await prepareAgent(page, title);
  await choose(page, dialog, "Visibility", "Workspace");
  await dialog.getByRole("button", { name: "Save agent", exact: true }).click();
  await page.waitForURL((url) =>
    /\/settings\/agents\/[0-9a-f-]{36}$/.test(url.pathname),
  );
  const id = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  const created = await getAgent(page, workspaceId, id);
  expect(created).toMatchObject({
    title,
    createdBy: userId,
    visibility: "workspace",
    instructions: `Private instructions for ${title}`,
    model: "qa-explicit-script-model",
    subscriptionId: null,
    archived: false,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No account selected", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit agent", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit agent", exact: true });
  const draft = unique("Agent stale draft");
  await edit.getByRole("textbox", { name: "Agent title" }).fill(draft);
  const externalTitle = unique("Agent acknowledged");
  const external = await page.request.patch(path(workspaceId, "agents", id), {
    headers: headers(page),
    data: { title: externalTitle, editToken: created.editToken },
  });
  expect(external.status()).toBe(200);
  const conflict = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && response.status() === 409,
  );
  await edit.getByRole("button", { name: "Save agent", exact: true }).click();
  await conflict;
  await expect(edit.getByRole("alert")).toContainText("This item changed.");
  await expect(edit.getByRole("textbox", { name: "Agent title" })).toHaveValue(
    draft,
  );
  expect((await getAgent(page, workspaceId, id)).title).toBe(externalTitle);
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Edit agent", exact: true }).click();
  const finalTitle = unique("Agent saved");
  const fresh = page.getByRole("dialog", { name: "Edit agent", exact: true });
  await fresh.getByRole("textbox", { name: "Agent title" }).fill(finalTitle);
  await fresh
    .getByRole("textbox", { name: "Agent instructions" })
    .fill("Saved Agent instructions");
  await fresh.getByRole("button", { name: "Save agent", exact: true }).click();
  await expect(fresh).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: finalTitle, exact: true }),
  ).toBeVisible();
  expect((await getAgent(page, workspaceId, id)).instructions).toBe(
    "Saved Agent instructions",
  );
  await more(page, "Archive");
  await expect
    .poll(async () => (await getAgent(page, workspaceId, id)).archived)
    .toBe(true);
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();
  await more(page, "Restore");
  await expect
    .poll(async () => (await getAgent(page, workspaceId, id)).archived)
    .toBe(false);
  await page.reload();
  await expect(
    page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Profile", exact: true }),
      })
      .getByText("Active", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Skill UI saves instructions, real supporting File references, export and Agent selection", async ({
  page,
  fixture,
}) => {
  const errors = recordPageErrors(page);
  const { workspaceId } = await register(page, fixture, "Skill QA Owner");
  const agent = await seedAgent(page, workspaceId, unique("Skill host Agent"));
  const title = unique("Reusable skill");
  const create = await prepareSkill(page, agent.id, title);
  await create
    .getByRole("button", { name: "Create skill", exact: true })
    .click();
  const detail = page.getByRole("dialog", { name: "Skill", exact: true });
  await expect(detail.getByLabel("Title", { exact: true })).toHaveValue(title);
  const listResponse = await page.request.get(
    `${path(workspaceId, "skills")}?query=${encodeURIComponent(title)}&limit=100`,
  );
  expect(listResponse.status()).toBe(200);
  const list = (await listResponse.json()) as {
    items: { id: string; title: string }[];
  };
  expect(list.items).toHaveLength(1);
  const id = list.items[0]?.id ?? "";
  const finalTitle = `saved-reusable-skill-${crypto.randomUUID()}`;
  await detail.getByLabel("Title", { exact: true }).fill(finalTitle);
  await detail
    .getByLabel("Instructions", { exact: true })
    .fill("Saved reusable instructions");
  await detail
    .getByRole("button", { name: "Save instructions", exact: true })
    .click();
  await expect
    .poll(async () => (await getSkill(page, workspaceId, id)).title)
    .toBe(finalTitle);

  // Small real binary upload through the production streaming/storage seam.
  const fileTitle = unique("Skill reference");
  const bytes = "Actual supporting reference bytes";
  const upload = await page.request.put(
    `${path(workspaceId, "files", crypto.randomUUID())}/content?${new URLSearchParams({ title: fileTitle, type: "text", mediaType: "text/plain", visibility: "user" })}`,
    {
      headers: { ...headers(page), "content-type": "application/octet-stream" },
      data: bytes,
    },
  );
  expect(upload.status()).toBe(200);
  const file = (await upload.json()) as { id: string; byteLength: number };
  expect(file.byteLength).toBe(new TextEncoder().encode(bytes).byteLength);
  // Reopen to discover the newly saved File through the live bounded picker.
  await closeSkill(detail);
  const files = await openSkill(page, finalTitle);
  await files
    .getByRole("textbox", { name: "Search supporting files by whole words" })
    .fill(fileTitle);
  await choose(page, files, "Supporting File", fileTitle);
  await files
    .getByRole("textbox", { name: "Supporting file path" })
    .fill("references/qa.txt");
  await files.getByRole("button", { name: "Add", exact: true }).click();
  await files
    .getByRole("button", { name: "Save supporting files", exact: true })
    .click();
  await expect
    .poll(async () => (await getSkill(page, workspaceId, id)).supportingFiles)
    .toEqual([
      expect.objectContaining({
        path: "references/qa.txt",
        fileId: file.id,
        byteLength: file.byteLength,
      }),
    ]);
  await files
    .getByRole("button", { name: "Export SKILL.md", exact: true })
    .click();
  await expect(
    files.getByRole("textbox", { name: "Exported SKILL.md" }),
  ).toHaveValue(/Saved reusable instructions/);
  await files
    .getByRole("button", { name: "Archive skill", exact: true })
    .click();
  await expect
    .poll(async () => (await getSkill(page, workspaceId, id)).archived)
    .toBe(true);
  await closeSkill(files);
  await choose(page, page, "Skill state", "Archived");
  const archived = await openSkill(page, finalTitle, true);
  await archived
    .getByRole("button", { name: "Restore skill", exact: true })
    .click();
  await expect
    .poll(async () => (await getSkill(page, workspaceId, id)).archived)
    .toBe(false);
  await closeSkill(archived);
  await choose(page, page, "Skill state", "Active");
  await page.getByRole("button", { name: "Edit agent", exact: true }).click();
  const agentEdit = page.getByRole("dialog", {
    name: "Edit agent",
    exact: true,
  });
  await agentEdit
    .getByRole("checkbox", { name: `Select ${finalTitle}`, exact: true })
    .check();
  await agentEdit
    .getByRole("button", { name: "Save agent", exact: true })
    .click();
  await expect(agentEdit).not.toBeVisible();
  expect((await getAgent(page, workspaceId, agent.id)).skillIds).toEqual([id]);
  await page.reload();
  const reopened = await openSkill(page, finalTitle);
  await expect(
    reopened.getByText("references/qa.txt", { exact: true }),
  ).toBeVisible();
  await expect(
    reopened.getByLabel("Instructions", { exact: true }),
  ).toHaveValue("Saved reusable instructions");
  expect(errors).toEqual([]);
});

test("Skill proposals respect creator control and cached Agent/Skill reads fail closed after revocation", async ({
  page,
  fixture,
  browser,
}) => {
  const errors = recordPageErrors(page);
  const { workspaceId } = await register(page, fixture, "Proposal QA Creator");
  const agent = await seedAgent(
    page,
    workspaceId,
    unique("Shared proposal Agent"),
  );
  const title = unique("Shared proposal skill");
  const create = await prepareSkill(page, agent.id, title);
  await choose(page, create, "Skill visibility", "Workspace");
  await create
    .getByRole("button", { name: "Create skill", exact: true })
    .click();
  const creator = page.getByRole("dialog", { name: "Skill", exact: true });
  await expect(creator.getByLabel("Title", { exact: true })).toHaveValue(title);
  const list = await page.request.get(
    `${path(workspaceId, "skills")}?query=${encodeURIComponent(title)}&limit=100`,
  );
  expect(list.status()).toBe(200);
  const id =
    ((await list.json()) as { items: { id: string }[] }).items[0]?.id ?? "";
  await closeSkill(creator);

  const context = await browser.newContext({ baseURL: fixture.origin });
  try {
    const contributor = await context.newPage();
    const contributorErrors = recordPageErrors(contributor);
    await register(
      contributor,
      fixture,
      "Proposal QA Contributor",
      "contributor",
    );
    await contributor.goto(`/settings/agents/${agent.id}`);
    await expect(
      contributor.getByRole("button", { name: "Edit agent", exact: true }),
    ).toHaveCount(0);
    let proposal = await openSkill(contributor, title);
    await expect(
      proposal.getByLabel("Instructions", { exact: true }),
    ).toBeDisabled();
    await expect(
      proposal.getByRole("button", { name: "Archive skill", exact: true }),
    ).toHaveCount(0);
    await proposal
      .getByRole("button", { name: "Propose changes", exact: true })
      .click();
    const proposedTitle = unique("Accepted proposal");
    await proposal.getByLabel("Title", { exact: true }).fill(proposedTitle);
    await proposal
      .getByLabel("Instructions", { exact: true })
      .fill("Proposed real instructions");
    await proposal
      .getByRole("button", { name: "Submit proposal", exact: true })
      .click();
    await expect(proposal.getByLabel("Title", { exact: true })).toHaveValue(
      title,
    );
    expect((await getSkill(page, workspaceId, id)).title).toBe(title);
    await expect(
      proposal.getByText(proposedTitle, { exact: true }),
    ).toBeVisible();
    await expect(
      proposal.getByRole("button", { name: "Accept", exact: true }),
    ).toHaveCount(0);
    const unauthorized = await contributor.request.patch(
      path(workspaceId, "skills", id),
      {
        headers: headers(contributor),
        data: {
          title: "Unauthorized",
          editToken: (await getSkill(page, workspaceId, id)).editToken,
        },
      },
    );
    expect(unauthorized.status()).toBe(403);
    await page.reload();
    const resolution = await openSkill(page, title);
    await resolution
      .getByRole("button", { name: "Accept", exact: true })
      .click();
    await expect(resolution.getByLabel("Title", { exact: true })).toHaveValue(
      proposedTitle,
    );
    await expect(
      resolution.getByText("No proposals", { exact: true }),
    ).toBeVisible();
    expect((await getSkill(page, workspaceId, id)).instructions).toBe(
      "Proposed real instructions",
    );

    // A second proposal is rejected; rejection must not alter accepted content.
    await closeSkill(proposal);
    await contributor.reload();
    proposal = await openSkill(contributor, proposedTitle);
    await proposal
      .getByRole("button", { name: "Propose changes", exact: true })
      .click();
    await proposal
      .getByLabel("Instructions", { exact: true })
      .fill("Rejected proposal bytes");
    await proposal
      .getByRole("button", { name: "Submit proposal", exact: true })
      .click();
    await expect(
      proposal.getByLabel("Instructions", { exact: true }),
    ).toHaveValue("Proposed real instructions");
    await closeSkill(resolution);
    await page.reload();
    const reject = await openSkill(page, proposedTitle);
    await reject.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(
      reject.getByText("No proposals", { exact: true }),
    ).toBeVisible();
    expect((await getSkill(page, workspaceId, id)).instructions).toBe(
      "Proposed real instructions",
    );

    // Change authority through the creator's real fenced PATCH, then refetch the
    // contributor's already rendered private instructions, preserving its cache.
    const saved = await getSkill(page, workspaceId, id);
    const revoke = await page.request.patch(path(workspaceId, "skills", id), {
      headers: headers(page),
      data: { visibility: "user", editToken: saved.editToken },
    });
    expect(revoke.status()).toBe(200);
    await refetchDenied(contributor, path(workspaceId, "skills", id));
    await expect(
      proposal.getByLabel("Instructions", { exact: true }),
    ).toHaveCount(0);
    await expect(
      proposal.getByText("Proposed real instructions", { exact: true }),
    ).toHaveCount(0);
    await expect(proposal.getByRole("alert")).toBeVisible();
    await expect(
      proposal.getByRole("button", { name: "Retry", exact: true }),
    ).toBeVisible();
    await proposal.locator('[data-slot="dialog-close"]').click();
    await expect(proposal).not.toBeVisible();
    const agentSnapshot = await getAgent(page, workspaceId, agent.id);
    const revokeAgent = await page.request.patch(
      path(workspaceId, "agents", agent.id),
      {
        headers: headers(page),
        data: { visibility: "user", editToken: agentSnapshot.editToken },
      },
    );
    expect(revokeAgent.status()).toBe(200);
    await refetchDenied(contributor, path(workspaceId, "agents", agent.id));
    await expect(
      contributor.getByText(agent.instructions, { exact: true }),
    ).toHaveCount(0);
    await expect(
      contributor.getByRole("heading", { name: agent.title, exact: true }),
    ).toHaveCount(0);
    await expect(contributor.getByRole("alert")).toBeVisible();
    expect(contributorErrors).toEqual([]);
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});

test("Schedule UI saves cron/manual policy, validates drafts, restores disabled and reports unavailable admission honestly", async ({
  page,
  fixture,
  browser,
}) => {
  const errors = recordPageErrors(page);
  const { workspaceId, userId } = await register(
    page,
    fixture,
    "Schedule QA Owner",
  );
  const agent = await seedAgent(
    page,
    workspaceId,
    unique("Schedule exact Agent"),
  );
  const chat = await seedChat(
    page,
    workspaceId,
    unique("Schedule output Chat"),
  );
  const participant = await page.request.post(
    `${path(workspaceId, "chats", chat.id)}/participants`,
    {
      headers: headers(page),
      data: { agentId: agent.id, role: "contributor" },
    },
  );
  expect(participant.status()).toBe(200);
  const title = unique("Schedule lifecycle");
  const create = await prepareSchedule(page, title, agent, chat);
  await choose(page, create, "Trigger", "Cron");
  await create.getByLabel("Cron expression", { exact: true }).fill("0 9 * *");
  await expect(
    create.getByRole("button", { name: "Save schedule" }),
  ).toBeDisabled();
  await create
    .getByLabel("Cron expression", { exact: true })
    .fill("0 9 * * 1-5");
  await create.getByLabel("Timezone", { exact: true }).fill("invalid-zone");
  await expect(
    create.getByRole("button", { name: "Save schedule" }),
  ).toBeDisabled();
  await create.getByLabel("Timezone", { exact: true }).fill("Europe/Berlin");
  await create
    .getByRole("button", { name: "Save schedule", exact: true })
    .click();
  await page.waitForURL((url) =>
    /\/schedules\/[0-9a-f-]{36}$/.test(url.pathname),
  );
  const id = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  const saved = await getSchedule(page, workspaceId, id);
  expect(saved).toMatchObject({
    title,
    agentId: agent.id,
    chatId: chat.id,
    ownerId: userId,
    type: "prompt",
    cron: "0 9 * * 1-5",
    timezone: "Europe/Berlin",
    status: "disabled",
  });
  await expect(
    page.getByText("No scheduled deliveries yet.", { exact: true }),
  ).toBeVisible();
  const history = await page.request.get(
    `${path(workspaceId, "schedules", id)}/history?limit=100`,
  );
  expect(history.status()).toBe(200);
  expect((await history.json()).items).toEqual([]);
  await more(page, "Edit schedule");
  const edit = page.getByRole("dialog", { name: "Edit schedule", exact: true });
  await edit
    .getByLabel("Prompt", { exact: true })
    .fill("Unsaved canceled schedule draft");
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await getSchedule(page, workspaceId, id)).body).toBe(
    `Private body ${title}`,
  );
  await more(page, "Edit schedule");
  await edit
    .getByLabel("Prompt", { exact: true })
    .fill("Stale Schedule private draft");
  const external = await page.request.patch(
    path(workspaceId, "schedules", id),
    {
      headers: headers(page),
      data: {
        body: "Acknowledged concurrent Schedule body",
        editToken: saved.editToken,
      },
    },
  );
  expect(external.status()).toBe(200);
  const conflict = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path(workspaceId, "schedules", id) &&
      response.request().method() === "PATCH" &&
      response.status() === 409,
  );
  await edit
    .getByRole("button", { name: "Save schedule", exact: true })
    .click();
  await conflict;
  await expect(edit.getByRole("alert")).toContainText("This item changed.");
  await expect(edit.getByLabel("Prompt", { exact: true })).toHaveValue(
    "Stale Schedule private draft",
  );
  expect((await getSchedule(page, workspaceId, id)).body).toBe(
    "Acknowledged concurrent Schedule body",
  );
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await more(page, "Edit schedule");
  const updatedTitle = unique("Saved schedule");
  await edit.getByLabel("Title", { exact: true }).fill(updatedTitle);
  await edit
    .getByLabel("Prompt", { exact: true })
    .fill("Saved Schedule private body");
  await choose(page, edit, "Trigger", "Manual only");
  await edit
    .getByRole("button", { name: "Save schedule", exact: true })
    .click();
  await expect(edit).not.toBeVisible();
  const manual = await getSchedule(page, workspaceId, id);
  expect(manual).toMatchObject({
    title: updatedTitle,
    body: "Saved Schedule private body",
    cron: "",
    status: "disabled",
  });
  expect(manual.editToken).not.toBe(saved.editToken);
  await more(page, "Enable");
  await expect
    .poll(async () => (await getSchedule(page, workspaceId, id)).status)
    .toBe("enabled");
  await more(page, "Disable");
  await expect
    .poll(async () => (await getSchedule(page, workspaceId, id)).status)
    .toBe("disabled");
  await more(page, "Archive");
  await expect
    .poll(async () => (await getSchedule(page, workspaceId, id)).status)
    .toBe("archived");
  await expect(
    page.getByRole("button", { name: "Run now", exact: true }),
  ).toHaveCount(0);
  await more(page, "Restore disabled");
  await expect
    .poll(async () => (await getSchedule(page, workspaceId, id)).status)
    .toBe("disabled");
  await page.reload();
  await expect(
    page.getByText("Saved Schedule private body", { exact: true }),
  ).toBeVisible();
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === path(workspaceId, "schedules") &&
      url.searchParams.get("query") === updatedTitle
    );
  });
  await page.goto(
    `/schedules?${new URLSearchParams({ query: updatedTitle, agent: agent.id, owner: userId, status: "disabled", type: "prompt", sort: "updatedAt", order: "desc" })}`,
  );
  const filterResponse = await filtered;
  expect(filterResponse.status()).toBe(200);
  const filterUrl = new URL(filterResponse.url());
  expect(filterUrl.searchParams.get("limit")).toBe("100");
  expect(filterUrl.searchParams.get("agentId")).toBe(agent.id);
  expect(filterUrl.searchParams.get("sort")).toBe("updatedAt");
  await page
    .getByRole("link")
    .filter({ has: page.getByText(updatedTitle, { exact: true }) })
    .click();

  // Fixture has no managed Pi/account. Real admission must return unavailable,
  // preserve the exact request UUID on retry and never render fabricated success.
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        `${path(workspaceId, "schedules", id)}/run` &&
      request.method() === "POST"
    )
      requests.push(request.postDataJSON().requestId);
  });
  for (const name of ["Run now", "Retry Run"]) {
    const denied = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `${path(workspaceId, "schedules", id)}/run` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name, exact: true }).click();
    const response = await denied;
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "This service is unavailable." }),
    ).toBeVisible();
  }
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(requests[1]).toBe(requests[0]);
  await expect(page.getByText("Run admitted", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Stop Run", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Schedule changes are paused until Otto acknowledges this admission.",
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Edit schedule", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");

  const context = await browser.newContext({ baseURL: fixture.origin });
  try {
    const contributor = await context.newPage();
    await register(contributor, fixture, "Schedule QA Reader", "contributor");
    await contributor.goto(`/schedules/${id}`);
    await expect(
      contributor.getByText("Saved Schedule private body", { exact: true }),
    ).toBeVisible();
    await expect(
      contributor.getByRole("button", { name: "Run now", exact: true }),
    ).toHaveCount(0);
    const revoke = await page.request.patch(
      path(workspaceId, "chats", chat.id),
      {
        headers: headers(page),
        data: { visibility: "participants" },
      },
    );
    expect(revoke.status()).toBe(200);
    await refetchDenied(contributor, path(workspaceId, "schedules", id));
    await expect(
      contributor.getByText("Saved Schedule private body", { exact: true }),
    ).toHaveCount(0);
    await expect(
      contributor.getByRole("heading", { name: updatedTitle, exact: true }),
    ).toHaveCount(0);
    await expect(contributor.getByRole("alert")).toBeVisible();
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});

for (const domain of ["Agent", "Skill", "Schedule"] as const) {
  test(`${domain} creation does not duplicate a real server write after its ACK is lost`, async ({
    page,
    fixture,
  }) => {
    const { workspaceId } = await register(
      page,
      fixture,
      `${domain} Lost ACK Owner`,
    );
    const title = unique(`${domain} lost ACK`);
    let dialog: Locator;
    let save: string;
    if (domain === "Agent") {
      dialog = await prepareAgent(page, title);
      save = "Save agent";
    } else {
      const agent = await seedAgent(
        page,
        workspaceId,
        unique("Lost ACK host Agent"),
      );
      if (domain === "Skill") {
        dialog = await prepareSkill(page, agent.id, title);
        save = "Create skill";
      } else {
        const chat = await seedChat(
          page,
          workspaceId,
          unique("Lost ACK output Chat"),
        );
        dialog = await prepareSchedule(page, title, agent, chat);
        await choose(page, dialog, "Schedule type", "Script");
        await expect(dialog.getByLabel("Script", { exact: true })).toHaveValue(
          `Private body ${title}`,
        );
        save = "Save schedule";
      }
    }
    const plural = `${domain.toLowerCase()}s`;
    const endpoint = path(workspaceId, plural);
    let writes = 0;
    let savedId = "";
    await page.route(`**${endpoint}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      writes++;
      // Fetch the real server ACK before severing its browser delivery. This
      // proves actual persisted bytes plus a lost ACK, not a simulated 503.
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const payload = await response.json();
      savedId = domain === "Agent" ? payload.agent.id : payload.id;
      await route.abort("failed");
    });
    await dialog.getByRole("button", { name: save, exact: true }).click();
    await expect(
      dialog.getByText(`Otto may have created this ${domain}.`, {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: save, exact: true }),
    ).toBeDisabled();
    // Exercise the form's own fence as well as its disabled submit button.
    await dialog.locator("form").evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });
    await expect.poll(() => writes).toBe(1);
    expect(savedId).toMatch(/^[0-9a-f-]{36}$/);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.unroute(`**${endpoint}`);
    const response = await page.request.get(
      `${endpoint}?query=${encodeURIComponent(title)}&limit=100`,
    );
    expect(response.status()).toBe(200);
    const items = (await response.json()).items as {
      id: string;
      title: string;
    }[];
    expect(items).toEqual([expect.objectContaining({ id: savedId, title })]);
    if (domain === "Schedule") {
      expect((await getSchedule(page, workspaceId, savedId)).type).toBe(
        "script",
      );
    }
    await page.reload();
    expect(writes).toBe(1);
  });
}
