import type { Locator, Page, Route } from "@playwright/test";
import type { hc, InferRequestType, InferResponseType } from "hono/client";
import type { RpcApp } from "../../apps/server/src/api";
import { register } from "./account";
import { expect, test } from "./live-app";

type Rpc = ReturnType<typeof hc<RpcApp>>["workspaces"][":workspaceId"];
type DocumentRecord = InferResponseType<Rpc["documents"][":id"]["$get"]>;
type DocumentCreation = InferRequestType<Rpc["documents"]["$post"]>["json"];
type CollectionRecord = InferResponseType<Rpc["collections"][":id"]["$get"]>;
type CollectionCreation = InferRequestType<Rpc["collections"]["$post"]>["json"];
type FileCreation = InferRequestType<Rpc["files"]["$post"]>["json"];

const documentPath = (workspaceId: string, id: string) =>
  `/api/workspaces/${workspaceId}/documents/${id}`;
const bodyEditor = (page: Page) => page.locator(".otto-editor").first();
const titleEditor = (page: Page) =>
  page.getByRole("textbox", { name: "Title", exact: true });
const collectionSection = (page: Page) =>
  page.locator("section").filter({
    has: page.getByRole("heading", { name: "Collection", exact: true }),
  });

async function createDocument(
  page: Page,
  workspaceId: string,
  overrides: Partial<DocumentCreation> = {},
): Promise<DocumentRecord> {
  const input: DocumentCreation = {
    title: `Document actions ${crypto.randomUUID()}`,
    body: "Authoritative saved body",
    visibility: "workspace",
    ...overrides,
  };
  const response = await page.request.post(
    `/api/workspaces/${workspaceId}/documents`,
    { data: input, headers: { origin: new URL(page.url()).origin } },
  );
  expect(response.status()).toBe(200);
  return response.json();
}

async function readDocument(page: Page, workspaceId: string, id: string) {
  const response = await page.request.get(documentPath(workspaceId, id));
  expect(response.status()).toBe(200);
  return (await response.json()) as DocumentRecord;
}

async function choose(page: Page, trigger: Locator, option: string) {
  // Native selects and Base UI combobox triggers share the accessible role.
  // Use the control's actual DOM semantics, including popup options when custom.
  if ((await trigger.evaluate((element) => element.tagName)) === "SELECT") {
    await trigger.selectOption({ label: option });
    return;
  }
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openDocument(page: Page, id: string, title: string) {
  await page.goto(`/documents/${id}`);
  await expect(titleEditor(page)).toHaveValue(title);
  await expect(bodyEditor(page)).toHaveAttribute("contenteditable", "true");
}

// Pause the actual browser request before it reaches the real server. Releasing
// the gate continues the original request; no successful response is fabricated.
async function holdMutation(page: Page, path: string, method: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const active = new Set<Promise<void>>();
  const pattern = `**${path}`;
  const handler = (route: Route) => {
    const continuation = (async () => {
      if (route.request().method() === method) {
        requests++;
        await gate;
      }
      await route.continue();
    })();
    const tracked: Promise<void> = continuation.finally(() => {
      active.delete(tracked);
    });
    active.add(tracked);
    return tracked;
  };
  await page.route(pattern, handler);
  return {
    async started() {
      await expect.poll(() => requests).toBe(1);
    },
    async finish() {
      release();
      // Unregister only after continuation has completed; otherwise Playwright
      // may auto-handle the paused route before this handler calls continue.
      await Promise.all([...active]);
      await page.unroute(pattern, handler);
    },
    count: () => requests,
  };
}

async function assertDocumentLocked(page: Page) {
  await expect(titleEditor(page)).toBeDisabled();
  await expect(bodyEditor(page)).toHaveAttribute("contenteditable", "false");
  await expect(
    page.getByRole("button", { name: "Save document", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Saving", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Archive", exact: true }),
  ).toBeDisabled();
}

// Advance only the browser clock past the production QueryClient's 10s stale
// window, then use its real visibility/focus subscription to refetch active data.
async function refetchVisible(page: Page) {
  await page.clock.fastForward(11_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    window.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    window.dispatchEvent(new Event("visibilitychange"));
  });
}

function failRead(status: number) {
  return (route: Route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({
            error: status >= 500 ? "unavailable" : "forbidden",
          }),
        })
      : route.continue();
}

test("Document create, body and metadata save, Cancel and actual stale edit conflict", async ({
  page,
  fixture,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { workspaceId } = await register(
    page,
    fixture,
    "Document Editor Owner",
  );
  await page.goto("/documents");
  await page.getByRole("button", { name: "New document", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "New document",
    exact: true,
  });
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Created document actions");
  await dialog
    .getByLabel("Body", { exact: true })
    .fill("Original created body");
  await dialog
    .getByLabel("Labels, one per line", { exact: true })
    .fill("First label");
  await choose(
    page,
    dialog.getByRole("combobox", { name: "Visibility", exact: true }),
    "Workspace",
  );
  await dialog
    .getByRole("button", { name: "Create document", exact: true })
    .click();
  await page.waitForURL((url) =>
    /\/documents\/[0-9a-f-]{36}$/.test(url.pathname),
  );
  const id = new URL(page.url()).pathname.split("/").at(-1);
  if (!id) throw new Error("Created Document route missing its ID");
  await expect(titleEditor(page)).toHaveValue("Created document actions");
  await expect(bodyEditor(page)).toHaveText("Original created body");
  let saved = await readDocument(page, workspaceId, id);
  expect(saved.visibility).toBe("workspace");
  expect(saved.labels).toEqual(["First label"]);

  await titleEditor(page).fill("Acknowledged document title");
  await bodyEditor(page).fill("Acknowledged Tiptap body");
  await page
    .getByLabel("Labels, one per line", { exact: true })
    .fill("Design\nSpecification");
  await choose(
    page,
    page.getByRole("combobox", { name: "Visibility", exact: true }),
    "Only me",
  );
  const held = await holdMutation(page, documentPath(workspaceId, id), "PATCH");
  try {
    await page
      .getByRole("button", { name: "Save document", exact: true })
      .click();
    await held.started();
    await assertDocumentLocked(page);
    await expect(
      page.getByLabel("Labels, one per line", { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("combobox", { name: "Visibility", exact: true }),
    ).toBeDisabled();
  } finally {
    await held.finish();
  }
  await expect(
    page.getByRole("button", { name: "Save document", exact: true }),
  ).toBeDisabled();
  expect(held.count()).toBe(1);
  saved = await readDocument(page, workspaceId, id);
  expect(saved.title).toBe("Acknowledged document title");
  expect(saved.body).toBe("Acknowledged Tiptap body");
  expect(saved.labels).toEqual(["Design", "Specification"]);
  expect(saved.visibility).toBe("user");
  await page.reload();
  await expect(titleEditor(page)).toHaveValue(saved.title);
  await expect(bodyEditor(page)).toHaveText(saved.body);

  await titleEditor(page).fill("Discarded title");
  await bodyEditor(page).fill("Discarded body");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .locator('[data-slot="breadcrumb"]')
    .getByRole("button", { name: "Documents", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/documents/${id}$`));
  await expect(bodyEditor(page)).toHaveText("Discarded body");
  await page
    .getByLabel("Labels, one per line", { exact: true })
    .fill("Discarded label");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(titleEditor(page)).toHaveValue(saved.title);
  await expect(bodyEditor(page)).toHaveText(saved.body);
  await expect(
    page.getByLabel("Labels, one per line", { exact: true }),
  ).toHaveValue("Design\nSpecification");

  await titleEditor(page).fill("Dirty title after competing write");
  await bodyEditor(page).fill("Dirty body after competing write");
  const competing = await page.request.patch(documentPath(workspaceId, id), {
    headers: { origin: fixture.origin },
    data: { title: "Other writer acknowledged", editToken: saved.editToken },
  });
  expect(competing.status()).toBe(200);
  const conflict = page.waitForResponse(
    (response) =>
      response.url().endsWith(documentPath(workspaceId, id)) &&
      response.request().method() === "PATCH",
  );
  await page
    .getByRole("button", { name: "Save document", exact: true })
    .click();
  expect((await conflict).status()).toBe(409);
  await expect(page.getByRole("alert")).toContainText("This item changed.");
  await expect(titleEditor(page)).toHaveValue(
    "Dirty title after competing write",
  );
  await expect(bodyEditor(page)).toHaveText("Dirty body after competing write");
  expect((await readDocument(page, workspaceId, id)).title).toBe(
    "Other writer acknowledged",
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("This document changed. Your draft is kept.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save document", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(titleEditor(page)).toHaveValue("Other writer acknowledged");
  await expect(bodyEditor(page)).toHaveText(saved.body);
  await page.screenshot({
    path: testInfo.outputPath("document-conflict-reconciled.png"),
  });
  expect(errors).toEqual([]);
});

test("Saved File attachment mutations lock the main draft until real acknowledgement", async ({
  page,
  fixture,
}, testInfo) => {
  const { workspaceId } = await register(
    page,
    fixture,
    "Document Attachment Owner",
  );
  const document = await createDocument(page, workspaceId);
  const fileInput: FileCreation = {
    requestId: crypto.randomUUID(),
    title: `Document attachment ${crypto.randomUUID()}.txt`,
    type: "file",
    mediaType: "text/plain",
    visibility: "workspace",
    bytes: Buffer.from("Real streamed peer attachment bytes").toString(
      "base64",
    ),
  };
  const fileResponse = await page.request.post(
    `/api/workspaces/${workspaceId}/files`,
    {
      data: fileInput,
      headers: { origin: fixture.origin },
    },
  );
  expect(fileResponse.status()).toBe(200);
  const file = (await fileResponse.json()) as InferResponseType<
    Rpc["files"]["$post"]
  >;
  await openDocument(page, document.id, document.title);
  await page
    .getByRole("button", { name: "Attach saved file", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Attach saved file",
    exact: true,
  });
  await choose(
    page,
    dialog.getByRole("combobox", { name: "File", exact: true }),
    file.title,
  );
  const path = `${documentPath(workspaceId, document.id)}/attachments`;
  const add = await holdMutation(page, path, "PUT");
  try {
    await dialog.getByRole("button", { name: "Attach", exact: true }).click();
    await add.started();
    await assertDocumentLocked(page);
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("combobox", { name: "File", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("attachment-pending-lock.png"),
    });
  } finally {
    await add.finish();
  }
  await expect(dialog).not.toBeVisible();
  expect((await readDocument(page, workspaceId, document.id)).fileIds).toEqual([
    file.id,
  ]);
  const link = page.getByRole("link", { name: file.title, exact: true });
  await expect(link).toHaveAttribute("href", `/files?open=${file.id}`);
  await page.reload();
  await expect(link).toBeVisible();
  const remove = await holdMutation(page, path, "PUT");
  try {
    await page
      .getByRole("button", { name: "Remove attachment", exact: true })
      .click();
    await remove.started();
    await assertDocumentLocked(page);
    await expect(
      page.getByRole("button", { name: "Remove attachment", exact: true }),
    ).toBeDisabled();
  } finally {
    await remove.finish();
  }
  await expect(page.getByText("No attachments", { exact: true })).toBeVisible();
  expect((await readDocument(page, workspaceId, document.id)).fileIds).toEqual(
    [],
  );
  expect(
    (
      await page.request.get(`/api/workspaces/${workspaceId}/files/${file.id}`)
    ).status(),
  ).toBe(200);
  expect(add.count()).toBe(1);
  expect(remove.count()).toBe(1);
});

test("Collection schema, typed properties, archive and restore persist through real UI flows", async ({
  page,
  fixture,
}, testInfo) => {
  const { workspaceId } = await register(
    page,
    fixture,
    "Document Collection Owner",
  );
  const document = await createDocument(page, workspaceId);
  await openDocument(page, document.id, document.title);
  await page
    .getByRole("button", { name: "New collection", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "New collection",
    exact: true,
  });
  const title = `Action collection ${crypto.randomUUID()}`;
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  for (const [index, field] of [
    { title: "Risk note", type: "text" },
    { title: "Effort", type: "number" },
    { title: "Reviewed", type: "checkbox" },
    { title: "Stage", type: "select" },
  ].entries()) {
    await dialog
      .getByRole("button", { name: "Add field", exact: true })
      .click();
    await dialog
      .getByLabel("Field title", { exact: true })
      .nth(index)
      .fill(field.title);
    if (field.type !== "text")
      await choose(
        page,
        dialog
          .getByRole("combobox", { name: "Field type", exact: true })
          .nth(index),
        field.type,
      );
  }
  await dialog
    .getByLabel("Choices, one per line (maximum 100)", { exact: true })
    .fill("Planned\nReady");
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/workspaces/${workspaceId}/collections`) &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Save collection", exact: true })
    .click();
  const created = await createdResponse;
  expect(created.status()).toBe(200);
  const collection = (await created.json()) as CollectionRecord;
  await expect(dialog).not.toBeVisible();
  expect(collection.fields.map((field) => field.type)).toEqual([
    "text",
    "number",
    "checkbox",
    "select",
  ]);
  await choose(
    page,
    page.getByRole("combobox", { name: "Collection", exact: true }),
    title,
  );
  await page
    .getByLabel("Risk note", { exact: true })
    .fill("Saved property text");
  await page.getByLabel("Effort", { exact: true }).fill("7");
  await page.getByRole("checkbox", { name: "Reviewed", exact: true }).check();
  await choose(
    page,
    page.getByRole("combobox", { name: "Stage", exact: true }),
    "Ready",
  );
  const held = await holdMutation(
    page,
    `${documentPath(workspaceId, document.id)}/collection`,
    "POST",
  );
  try {
    await page
      .getByRole("button", { name: "Save properties", exact: true })
      .click();
    await held.started();
    await assertDocumentLocked(page);
    await expect(page.getByLabel("Risk note", { exact: true })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Save properties", exact: true }),
    ).toBeDisabled();
  } finally {
    await held.finish();
  }
  await expect(
    page.getByRole("button", { name: "Save properties", exact: true }),
  ).toBeDisabled();
  await expect(titleEditor(page)).toBeEnabled();
  const saved = await readDocument(page, workspaceId, document.id);
  expect(saved.collectionId).toBe(collection.id);
  expect(saved.properties).toEqual(
    Object.fromEntries(
      collection.fields.map((field, index) => [
        field.id,
        ["Saved property text", 7, true, "Ready"][index],
      ]),
    ),
  );
  await page.reload();
  await expect(page.getByLabel("Risk note", { exact: true })).toHaveValue(
    "Saved property text",
  );
  await expect(page.getByLabel("Effort", { exact: true })).toHaveValue("7");
  await expect(
    page.getByRole("checkbox", { name: "Reviewed", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Stage", exact: true }),
  ).toContainText("Ready");
  await page
    .getByLabel("Risk note", { exact: true })
    .fill("Discarded property text");
  await page
    .getByRole("button", { name: "Cancel properties", exact: true })
    .click();
  await expect(page.getByLabel("Risk note", { exact: true })).toHaveValue(
    "Saved property text",
  );

  await page
    .getByRole("button", { name: "Manage collection", exact: true })
    .click();
  const manage = page.getByRole("dialog", {
    name: "Manage collection",
    exact: true,
  });
  await expect(
    manage.getByRole("combobox", { name: "Field type", exact: true }).first(),
  ).toBeDisabled();
  await manage.getByLabel("Title", { exact: true }).fill(`${title} renamed`);
  await choose(
    page,
    manage.getByRole("combobox", { name: "View", exact: true }),
    "List",
  );
  await manage
    .getByRole("button", { name: "Save collection", exact: true })
    .click();
  await expect(manage).not.toBeVisible();
  const metadataResponse = await page.request.get(
    `/api/workspaces/${workspaceId}/collections/${collection.id}`,
  );
  expect(metadataResponse.status()).toBe(200);
  const metadata = (await metadataResponse.json()) as CollectionRecord;
  expect(metadata.title).toBe(`${title} renamed`);
  expect(metadata.view).toBe("list");
  expect(metadata.fields).toEqual(collection.fields);
  await page
    .getByRole("button", { name: "Manage collection", exact: true })
    .click();
  await manage
    .getByRole("button", { name: "Archive collection", exact: true })
    .click();
  await expect(manage).not.toBeVisible();
  await expect(
    page.getByText("This Collection is archived.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Risk note", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Manage collection", exact: true })
    .click();
  await manage
    .getByRole("button", { name: "Restore collection", exact: true })
    .click();
  await expect(manage).not.toBeVisible();
  await expect(page.getByLabel("Risk note", { exact: true })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("collection-properties-restored.png"),
  });
  expect(held.count()).toBe(1);
});

test("A noncreator proposes, the author accepts under the shared lock and rejects a stale proposal", async ({
  page,
  fixture,
  browser,
}, testInfo) => {
  const { workspaceId } = await register(
    page,
    fixture,
    "Document Proposal Author",
  );
  const document = await createDocument(page, workspaceId);
  const contributor = await browser.newContext({ baseURL: fixture.origin });
  try {
    const proposer = await contributor.newPage();
    await register(
      proposer,
      fixture,
      "Document Proposal Contributor",
      "contributor",
    );
    await proposer.goto(`/documents/${document.id}`);
    await expect(
      proposer.getByRole("heading", { name: document.title, exact: true }),
    ).toBeVisible();
    await expect(titleEditor(proposer)).toHaveCount(0);
    await expect(
      proposer.getByRole("button", { name: "Save document", exact: true }),
    ).toHaveCount(0);
    const forbidden = await proposer.request.patch(
      documentPath(workspaceId, document.id),
      {
        headers: { origin: fixture.origin },
        data: { title: "Forbidden direct edit", editToken: document.editToken },
      },
    );
    expect(forbidden.status()).toBe(403);
    await proposer
      .getByRole("button", { name: "Propose a change", exact: true })
      .click();
    const proposal = proposer.getByRole("dialog", {
      name: "Propose a change",
      exact: true,
    });
    await proposal
      .getByLabel("Title", { exact: true })
      .fill("Accepted proposed title");
    await proposal
      .getByLabel("Body", { exact: true })
      .fill("Accepted proposed body");
    await proposal
      .getByRole("button", { name: "Submit proposal", exact: true })
      .click();
    await expect(proposal).not.toBeVisible();
    expect((await readDocument(page, workspaceId, document.id)).body).toBe(
      document.body,
    );
    await openDocument(page, document.id, document.title);
    await expect(
      page.getByRole("heading", {
        name: "Accepted proposed title",
        exact: true,
      }),
    ).toBeVisible();
    const proposalsResponse = await page.request.get(
      `${documentPath(workspaceId, document.id)}/proposals?limit=100`,
    );
    expect(proposalsResponse.status()).toBe(200);
    const proposals = (await proposalsResponse.json()) as InferResponseType<
      Rpc["documents"][":id"]["proposals"]["$get"]
    >;
    expect(proposals.items).toHaveLength(1);
    const accepted = proposals.items[0];
    if (!accepted) throw new Error("Submitted proposal missing");
    const held = await holdMutation(
      page,
      `${documentPath(workspaceId, document.id)}/proposals/${accepted.id}/resolve`,
      "POST",
    );
    try {
      await page.getByRole("button", { name: "Accept", exact: true }).click();
      await held.started();
      await assertDocumentLocked(page);
      await expect(
        page.getByRole("button", { name: "Reject", exact: true }),
      ).toBeDisabled();
    } finally {
      await held.finish();
    }
    await expect(titleEditor(page)).toHaveValue("Accepted proposed title");
    await expect(bodyEditor(page)).toHaveText("Accepted proposed body");
    await expect(
      page.getByRole("button", { name: "Accept", exact: true }),
    ).toHaveCount(0);
    const acceptedDocument = await readDocument(page, workspaceId, document.id);
    expect(acceptedDocument.title).toBe("Accepted proposed title");
    expect(acceptedDocument.body).toBe("Accepted proposed body");
    await proposer.reload();
    await proposer
      .getByRole("button", { name: "Propose a change", exact: true })
      .click();
    await proposal
      .getByLabel("Title", { exact: true })
      .fill("Stale proposal title");
    await proposal
      .getByLabel("Body", { exact: true })
      .fill("Stale proposal body");
    await proposal
      .getByRole("button", { name: "Submit proposal", exact: true })
      .click();
    await expect(proposal).not.toBeVisible();
    const advance = await page.request.patch(
      documentPath(workspaceId, document.id),
      {
        headers: { origin: fixture.origin },
        data: {
          body: "New authoritative body",
          editToken: acceptedDocument.editToken,
        },
      },
    );
    expect(advance.status()).toBe(200);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Stale proposal title", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Accept", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Stale proposal title", exact: true }),
    ).toHaveCount(0);
    expect((await readDocument(page, workspaceId, document.id)).body).toBe(
      "New authoritative body",
    );
    await page.screenshot({
      path: testInfo.outputPath("proposal-accepted-and-stale-rejected.png"),
    });
    expect(held.count()).toBe(1);
  } finally {
    await contributor.close();
  }
});

test("Transient cached reads preserve dirty drafts, denied reads hide Document and Collection data", async ({
  page,
  fixture,
}, testInfo) => {
  const { workspaceId } = await register(
    page,
    fixture,
    "Document Read Failure Owner",
  );
  const document = await createDocument(page, workspaceId);
  const fieldId = crypto.randomUUID();
  const input: CollectionCreation = {
    title: `Sensitive Collection ${crypto.randomUUID()}`,
    fields: [{ id: fieldId, title: "Sensitive property", type: "text" }],
  };
  const created = await page.request.post(
    `/api/workspaces/${workspaceId}/collections`,
    {
      data: input,
      headers: { origin: fixture.origin },
    },
  );
  expect(created.status()).toBe(200);
  const collection = (await created.json()) as CollectionRecord;
  const assigned = await page.request.post(
    `${documentPath(workspaceId, document.id)}/collection`,
    {
      headers: { origin: fixture.origin },
      data: {
        collectionId: collection.id,
        properties: { [fieldId]: "Authoritative property" },
        editToken: document.editToken,
      },
    },
  );
  expect(assigned.status()).toBe(200);
  await openDocument(page, document.id, document.title);
  await page.clock.install();
  await page
    .getByLabel("Sensitive property", { exact: true })
    .fill("Dirty retained property");
  await titleEditor(page).fill("Dirty retained title");
  await bodyEditor(page).fill("Dirty retained body");
  const documentPattern = `**${documentPath(workspaceId, document.id)}`;
  const collectionPattern = `**/api/workspaces/${workspaceId}/collections/${collection.id}`;
  await page.route(documentPattern, failRead(503));
  await page.route(collectionPattern, failRead(503));
  await refetchVisible(page);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "This service is unavailable." })
      .first(),
  ).toBeVisible();
  await expect(titleEditor(page)).toHaveValue("Dirty retained title");
  await expect(titleEditor(page)).toBeDisabled();
  await expect(bodyEditor(page)).toHaveText("Dirty retained body");
  await expect(bodyEditor(page)).toHaveAttribute("contenteditable", "false");
  await expect(
    page.getByLabel("Sensitive property", { exact: true }),
  ).toHaveValue("Dirty retained property");
  await expect(
    page.getByLabel("Sensitive property", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save properties", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("dirty-drafts-during-503.png"),
  });
  await page.unroute(documentPattern);
  await page.unroute(collectionPattern);
  await page
    .getByRole("button", { name: "Retry", exact: true })
    .first()
    .click();
  await collectionSection(page)
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(titleEditor(page)).toHaveValue("Dirty retained title");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(titleEditor(page)).toHaveValue(document.title);
  await expect(
    page.getByLabel("Sensitive property", { exact: true }),
  ).toHaveValue("Dirty retained property");
  await expect(
    page.getByLabel("Sensitive property", { exact: true }),
  ).toBeEnabled();

  // Only the property draft is dirty here. A transient main read lock must not
  // disable its leave guard, which previously depended on !blocked.
  await page.route(documentPattern, failRead(503));
  await refetchVisible(page);
  await expect(titleEditor(page)).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .locator('[data-slot="breadcrumb"]')
    .getByRole("button", { name: "Documents", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/documents/${document.id}$`));
  await expect(
    page.getByLabel("Sensitive property", { exact: true }),
  ).toHaveValue("Dirty retained property");
  await page.unroute(documentPattern);
  await page
    .getByRole("button", { name: "Retry", exact: true })
    .first()
    .click();
  await expect(titleEditor(page)).toBeEnabled();

  for (const status of [403, 404]) {
    await page.route(collectionPattern, failRead(status));
    await refetchVisible(page);
    await expect(collectionSection(page).getByRole("alert")).toBeVisible();
    await expect(
      page.getByLabel("Sensitive property", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(collection.title, { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Manage collection", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save properties", exact: true }),
    ).toBeDisabled();
    await page.unroute(collectionPattern);
    await collectionSection(page)
      .getByRole("button", { name: "Retry", exact: true })
      .click();
    await expect(
      page.getByLabel("Sensitive property", { exact: true }),
    ).toHaveValue("Dirty retained property");
  }
  await page
    .getByRole("button", { name: "Cancel properties", exact: true })
    .click();
  for (const status of [403, 404]) {
    await page.route(documentPattern, failRead(status));
    await refetchVisible(page);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(titleEditor(page)).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: document.title, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Sensitive property", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save document", exact: true }),
    ).toHaveCount(0);
    await page.unroute(documentPattern);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(titleEditor(page)).toHaveValue(document.title);
  }
  await page.screenshot({
    path: testInfo.outputPath(
      "denied-read-recovered-authoritative-document.png",
    ),
  });
});
