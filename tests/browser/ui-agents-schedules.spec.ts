import type { Locator, Page } from "@playwright/test";
import type { hc, InferRequestType, InferResponseType } from "hono/client";
import type { RpcApp } from "../../apps/server/src/api";
import { register } from "./account";
import { expect, test } from "./live-app";
import { nativeSettingsTest, prepareNativeSettings } from "./native-settings";

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
async function seedChat(
  page: Page,
  workspaceId: string,
  title: string,
  visibility: Chat["visibility"] = "workspace",
) {
  const response = await page.request.post(path(workspaceId, "chats"), {
    headers: headers(page),
    data: { title, visibility } satisfies InferRequestType<
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
async function openSkill(page: Page, title: string) {
  await page
    .locator('[data-slot="item"]')
    .filter({ has: page.getByText(title, { exact: true }) })
    .getByRole("button", {
      name: "Open skill",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Skill", exact: true });
  await expect(
    dialog.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  return dialog;
}
async function closeSkill(dialog: Locator) {
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
  await expect(edit.getByRole("alert")).toContainText("This item changed,");
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

nativeSettingsTest(
  "Skill UI saves instructions, real supporting File references, export and Agent selection",
  async ({ page, fixture }, testInfo) => {
    const errors = recordPageErrors(page);
    const { workspaceId } = await register(page, fixture, "Skill QA Owner");
    const native = await prepareNativeSettings(page, fixture, workspaceId);
    const agent = await seedAgent(
      page,
      workspaceId,
      unique("Skill host Agent"),
    );
    const title = `reusable-skill-${crypto.randomUUID()}`;
    const created = await native.approve({
      type: "skill.create",
      title,
      instructions: `Use ${title}`,
      whenToUse: "For QA requests",
      visibility: "user",
    });
    await page.goto("/settings/skills");
    const detail = await openSkill(page, title);
    const listResponse = await page.request.get(
      `${path(workspaceId, "skills")}?query=${encodeURIComponent(title)}&limit=100`,
    );
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as {
      items: { id: string; title: string }[];
    };
    expect(list.items).toHaveLength(1);
    const id = list.items[0]?.id ?? "";
    expect(id).toBe(created.id);
    const finalTitle = `saved-reusable-skill-${crypto.randomUUID()}`;
    await closeSkill(detail);
    await native.approve({
      type: "skill.update",
      id,
      editToken: (await getSkill(page, workspaceId, id)).editToken,
      title: finalTitle,
      instructions: "Saved reusable instructions",
    });
    await expect
      .poll(async () => (await getSkill(page, workspaceId, id)).title)
      .toBe(finalTitle);

    const fileTitle = unique("Skill reference");
    const bytes = "Actual supporting reference bytes";
    const upload = await page.request.put(
      `${path(workspaceId, "files", crypto.randomUUID())}/content?${new URLSearchParams({ title: fileTitle, type: "text", mediaType: "text/plain", visibility: "user" })}`,
      {
        headers: {
          ...headers(page),
          "content-type": "application/octet-stream",
        },
        data: bytes,
      },
    );
    expect(upload.status()).toBe(200);
    const file = (await upload.json()) as { id: string; byteLength: number };
    expect(file.byteLength).toBe(new TextEncoder().encode(bytes).byteLength);
    await native.approve({
      type: "skill.files",
      id,
      editToken: (await getSkill(page, workspaceId, id)).editToken,
      files: [{ path: "references/qa.txt", fileId: file.id }],
    });
    await page.goto("/settings/skills");
    const files = await openSkill(page, finalTitle);
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
    await expect(
      files.getByRole("textbox", { name: "Exported SKILL.md" }),
    ).toHaveAttribute("readonly", "");
    await files
      .getByRole("button", { name: "Archive skill", exact: true })
      .click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toBeVisible();
    expect((await getSkill(page, workspaceId, id)).archived).toBe(false);
    await confirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect((await getSkill(page, workspaceId, id)).archived).toBe(false);
    await files
      .getByRole("button", { name: "Archive skill", exact: true })
      .click();
    await confirmation
      .getByRole("button", { name: "Archive skill", exact: true })
      .click();
    await expect
      .poll(async () => (await getSkill(page, workspaceId, id)).archived)
      .toBe(true);
    await closeSkill(files);
    await expect(
      page.getByRole("button", { name: /^Skill state:/ }),
    ).toBeVisible();
    await testInfo.attach("archived-only-skill-navigation", {
      body: await page.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
    await choose(page, page, "Skill state", "Archived");
    const archived = await openSkill(page, finalTitle);
    await archived
      .getByRole("button", { name: "Restore skill", exact: true })
      .click();
    await expect(confirmation).toBeVisible();
    expect((await getSkill(page, workspaceId, id)).archived).toBe(true);
    await confirmation
      .getByRole("button", { name: "Restore skill", exact: true })
      .click();
    await expect
      .poll(async () => (await getSkill(page, workspaceId, id)).archived)
      .toBe(false);
    await closeSkill(archived);
    await choose(page, page, "Skill state", "Active");
    await native.approve({
      type: "agent.update",
      id: agent.id,
      editToken: (await getAgent(page, workspaceId, agent.id)).editToken,
      skillIds: [...agent.skillIds, id],
    });
    expect((await getAgent(page, workspaceId, agent.id)).skillIds).toEqual([
      id,
    ]);
    await page.goto(`/settings/agents/${agent.id}`);
    await page.reload();
    const reopened = await openSkill(page, finalTitle);
    await expect(
      reopened.getByText("references/qa.txt", { exact: true }),
    ).toBeVisible();
    await expect(
      reopened.getByText("Saved reusable instructions", { exact: true }),
    ).toBeVisible();
    await expect(reopened.getByRole("textbox")).toHaveCount(0);
    await testInfo.attach("restored-skill-persisted-supporting-files", {
      body: await page.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
    expect(errors).toEqual([]);
  },
);

nativeSettingsTest(
  "Skill proposals respect creator control and cached Agent/Skill reads fail closed after revocation",
  async ({ page, fixture, browser }) => {
    const errors = recordPageErrors(page);
    const { workspaceId } = await register(
      page,
      fixture,
      "Proposal QA Creator",
    );
    const native = await prepareNativeSettings(page, fixture, workspaceId);
    const agent = await seedAgent(
      page,
      workspaceId,
      unique("Proposal host Agent"),
    );
    const title = unique("Shared proposal skill");
    const created = await native.approve({
      type: "skill.create",
      title,
      instructions: `Use ${title}`,
      whenToUse: "For QA requests",
      visibility: "workspace",
    });
    const list = await page.request.get(
      `${path(workspaceId, "skills")}?query=${encodeURIComponent(title)}&limit=100`,
    );
    expect(list.status()).toBe(200);
    const id =
      ((await list.json()) as { items: { id: string }[] }).items[0]?.id ?? "";
    expect(id).toBe(created.id);
    await native.approve({
      type: "agent.update",
      id: agent.id,
      editToken: (await getAgent(page, workspaceId, agent.id)).editToken,
      skillIds: [...agent.skillIds, id],
    });
    await page.goto("/settings/skills");
    const creator = await openSkill(page, title);
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
        contributor.getByRole("heading", { name: agent.title, exact: true }),
      ).toBeVisible();
      await expect(
        contributor.getByText(agent.instructions, { exact: true }),
      ).toBeVisible();
      await expect(
        contributor.getByRole("button", { name: "Edit agent", exact: true }),
      ).toHaveCount(0);
      let proposal = await openSkill(contributor, title);
      await expect(
        proposal.getByText(`Use ${title}`, { exact: true }),
      ).toBeVisible();
      await expect(proposal.getByRole("textbox")).toHaveCount(0);
      await expect(
        proposal.getByRole("button", { name: "Archive skill", exact: true }),
      ).toHaveCount(0);
      const proposedTitle = unique("Accepted proposal");
      const submitted = await contributor.request.post(
        `${path(workspaceId, "skills", id)}/proposals`,
        {
          headers: headers(contributor),
          data: {
            title: proposedTitle,
            instructions: "Proposed real instructions",
            editToken: (await getSkill(page, workspaceId, id)).editToken,
          },
        },
      );
      expect(submitted.status()).toBe(200);
      const acceptedProposal = (await submitted.json()) as { id: string };
      await closeSkill(proposal);
      await contributor.reload();
      proposal = await openSkill(contributor, title);
      await expect(
        proposal.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      expect((await getSkill(page, workspaceId, id)).title).toBe(title);
      await expect(
        proposal.getByText(proposedTitle, { exact: true }),
      ).toBeVisible();
      await expect(
        proposal.getByRole("button", { name: "Accept", exact: true }),
      ).toHaveCount(0);
      await expect(
        proposal.getByRole("button", { name: "Reject", exact: true }),
      ).toHaveCount(0);
      const unauthorizedResolution = await contributor.request.post(
        `${path(workspaceId, "skills", id)}/proposals/${acceptedProposal.id}/resolve`,
        {
          headers: headers(contributor),
          data: { accept: true },
        },
      );
      expect(unauthorizedResolution.status()).toBe(403);
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
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Accept", exact: true })
        .click();
      await expect(
        resolution.getByRole("heading", { name: proposedTitle, exact: true }),
      ).toBeVisible();
      await expect(
        resolution.getByText("No proposals", { exact: true }),
      ).toBeVisible();
      expect((await getSkill(page, workspaceId, id)).instructions).toBe(
        "Proposed real instructions",
      );

      await closeSkill(proposal);
      await contributor.reload();
      proposal = await openSkill(contributor, proposedTitle);
      const rejectedSubmission = await contributor.request.post(
        `${path(workspaceId, "skills", id)}/proposals`,
        {
          headers: headers(contributor),
          data: {
            title: proposedTitle,
            instructions: "Rejected proposal bytes",
            editToken: (await getSkill(page, workspaceId, id)).editToken,
          },
        },
      );
      expect(rejectedSubmission.status()).toBe(200);
      const rejectedProposal = (await rejectedSubmission.json()) as {
        id: string;
      };
      const unauthorizedRejection = await contributor.request.post(
        `${path(workspaceId, "skills", id)}/proposals/${rejectedProposal.id}/resolve`,
        {
          headers: headers(contributor),
          data: { accept: false },
        },
      );
      expect(unauthorizedRejection.status()).toBe(403);
      await expect(
        proposal.getByText("Proposed real instructions", { exact: true }),
      ).toBeVisible();
      await closeSkill(resolution);
      await page.reload();
      const reject = await openSkill(page, proposedTitle);
      await reject.getByRole("button", { name: "Reject", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Reject", exact: true })
        .click();
      await expect(
        reject.getByText("No proposals", { exact: true }),
      ).toBeVisible();
      expect((await getSkill(page, workspaceId, id)).instructions).toBe(
        "Proposed real instructions",
      );

      const saved = await getSkill(page, workspaceId, id);
      await native.approve({
        type: "skill.update",
        id,
        visibility: "user",
        editToken: saved.editToken,
      });
      await refetchDenied(contributor, path(workspaceId, "skills", id));
      await expect(proposal.locator("pre")).toHaveCount(0);
      await expect(
        proposal.getByText("Proposed real instructions", { exact: true }),
      ).toHaveCount(0);
      await expect(
        proposal.getByRole("heading", { name: proposedTitle, exact: true }),
      ).toHaveCount(0);
      await expect(proposal.getByRole("alert")).toBeVisible();
      await expect(
        proposal.getByRole("button", { name: "Retry", exact: true }),
      ).toBeVisible();
      await proposal.locator('[data-slot="dialog-close"]').click();
      await expect(proposal).not.toBeVisible();
      await expect(
        contributor.getByText(proposedTitle, { exact: true }),
      ).toHaveCount(0);
      await expect(
        contributor.getByText("Unavailable skill", { exact: true }),
      ).toBeVisible();
      await expect(
        contributor.getByRole("button", { name: "Open skill", exact: true }),
      ).toHaveCount(0);
      const agentSnapshot = await getAgent(page, workspaceId, agent.id);
      await native.approve({
        type: "agent.update",
        id: agent.id,
        visibility: "user",
        editToken: agentSnapshot.editToken,
        skillIds: agentSnapshot.skillIds,
      });
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
  },
);

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
    "participants",
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
  await expect(edit.getByRole("alert")).toContainText("This item changed,");
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
        .filter({ hasText: "This service is unavailable," }),
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
    const reader = await register(
      contributor,
      fixture,
      "Schedule QA Reader",
      "contributor",
    );
    const grant = await page.request.post(
      `${path(workspaceId, "chats", chat.id)}/participants`,
      {
        headers: headers(page),
        data: { userId: reader.userId, role: "viewer" },
      },
    );
    expect(grant.status()).toBe(200);
    const participants = await page.request.get(
      `${path(workspaceId, "chats", chat.id)}/participants?limit=100&type=human`,
    );
    expect(participants.status()).toBe(200);
    const audience = (await participants.json()) as InferResponseType<
      WorkspaceApi["chats"][":id"]["participants"]["$get"]
    >;
    const participant = audience.items.find(
      (item) => item.userId === reader.userId,
    );
    expect(participant).toBeDefined();
    if (!participant) throw new Error("Reader participant missing after ACK");
    await contributor.goto(`/schedules/${id}`);
    await expect(
      contributor.getByText("Saved Schedule private body", { exact: true }),
    ).toBeVisible();
    await expect(
      contributor.getByRole("button", { name: "Run now", exact: true }),
    ).toHaveCount(0);
    const revoke = await page.request.delete(
      `${path(workspaceId, "chats", chat.id)}/participants/${participant.id}`,
      { headers: headers(page) },
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

for (const domain of ["Agent", "Schedule"] as const) {
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

nativeSettingsTest(
  "Skill creation does not duplicate a real server write after its ACK is lost",
  async ({ page, fixture }) => {
    const { workspaceId } = await register(
      page,
      fixture,
      "Skill Lost ACK Owner",
    );
    const native = await prepareNativeSettings(page, fixture, workspaceId);
    const title = unique("Skill lost ACK");
    let creations = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        (new URL(request.url()).pathname === path(workspaceId, "skills") ||
          (new URL(request.url()).pathname === path(workspaceId, "runs") &&
            typeof request.postDataJSON().body === "string" &&
            request.postDataJSON().body.includes(title)))
      )
        creations++;
    });
    const proposed = await native.propose({
      type: "skill.create",
      title,
      instructions: `Use ${title}`,
      whenToUse: "For QA requests",
      visibility: "user",
    });
    let writes = 0;
    let savedId = "";
    let release: (() => void) | undefined;
    const delivery = new Promise<void>((resolve) => {
      release = resolve;
    });
    let aborted: (() => void) | undefined;
    const lostDelivery = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    await page.route(`**${proposed.resolutionPath}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      writes++;
      expect(route.request().postDataJSON()).toEqual({
        decision: "approve",
        digest: proposed.action.digest,
      });
      await delivery;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const receipt = (await response.json()) as {
        status: string;
        result: { id: string };
      };
      expect(receipt.status).toBe("approved");
      savedId = receipt.result.id;
      await route.abort("failed");
      aborted?.();
    });
    const approve = page.getByRole("button", {
      name: "Approve exact action",
      exact: true,
    });
    await approve.click();
    try {
      await expect(
        page.getByText("Submitting approval; execution is not yet confirmed.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(approve).toBeDisabled();
      await approve.evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });
      await expect.poll(() => writes).toBe(1);
      expect(creations).toBe(1);
    } finally {
      release?.();
    }
    await lostDelivery;
    expect(savedId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("alert").filter({
        hasText: "No successful decision was acknowledged.",
      }),
    ).toBeVisible();
    const endpoint = path(workspaceId, "skills");
    const response = await page.request.get(
      `${endpoint}?query=${encodeURIComponent(title)}&limit=100`,
    );
    expect(response.status()).toBe(200);
    expect((await response.json()).items).toEqual([
      expect.objectContaining({ id: savedId, title }),
    ]);
    expect((await getSkill(page, workspaceId, savedId)).instructions).toBe(
      `Use ${title}`,
    );
    await expect
      .poll(async () => {
        const run = await page.request.get(
          path(workspaceId, "runs", proposed.runId),
        );
        expect(run.status()).toBe(200);
        return (await run.json()).state;
      })
      .toBe("finished");
    await page.reload();
    await page
      .getByRole("button", {
        name: `${native.agent.title}: finished`,
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Approved. The server recorded the action result.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(approve).toHaveCount(0);
    const recovered = await page.request.get(
      `${path(workspaceId, "runs", proposed.runId)}/actions`,
    );
    expect(recovered.status()).toBe(200);
    expect((await recovered.json()).items).toEqual([
      expect.objectContaining({
        id: proposed.action.id,
        digest: proposed.action.digest,
        status: "approved",
        result: expect.objectContaining({ id: savedId }),
      }),
    ]);
    await page.goto("/settings/skills");
    const detail = await openSkill(page, title);
    await expect(
      detail.getByText(`Use ${title}`, { exact: true }),
    ).toBeVisible();
    await closeSkill(detail);
    await page.reload();
    const afterReload = await page.request.get(
      `${endpoint}?query=${encodeURIComponent(title)}&limit=100`,
    );
    expect(afterReload.status()).toBe(200);
    expect((await afterReload.json()).items).toEqual([
      expect.objectContaining({ id: savedId, title }),
    ]);
    expect(writes).toBe(1);
    expect(creations).toBe(1);
    await page.unroute(`**${proposed.resolutionPath}`);
  },
);
