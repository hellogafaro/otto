import { expect, test } from "./live-app";

test("Projects Tasks and Documents persist real edits and reject stale writes", async ({
  page,
  fixture,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("UI Workflow Owner");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`flow-${crypto.randomUUID()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill(crypto.randomUUID() + crypto.randomUUID());
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByText("No workspace access.", { exact: false }),
  ).toBeVisible();
  const userId = await page.evaluate(
    async () =>
      (await (await fetch("/api/auth/get-session")).json()).user.id as string,
  );
  const workspaceId = await fixture.grant(userId);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(
    page.getByText("Nothing needs you", { exact: true }),
  ).toBeVisible();
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Launch Project");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Launch Project", exact: true }),
  ).toBeVisible();
  await page.waitForURL((url) =>
    /\/projects\/[0-9a-f-]{36}$/.test(url.pathname),
  );
  const projectId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Launch Project", exact: true }),
  ).toBeVisible();
  await page.goto(`/tasks?project=${projectId}`);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Verify Launch Task");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Saved real task notes");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Verify Launch Task", exact: true }),
  ).toBeVisible();
  await page.waitForURL((url) => /\/tasks\/[0-9a-f-]{36}$/.test(url.pathname));
  const taskId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  await page.reload();
  await expect(
    page.getByText("Saved real task notes", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit task", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: "docs/evidence/ui-task-desktop.png" });
  await page.goto("/documents");
  await page.getByRole("button", { name: "New document", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Launch Notes");
  await page
    .getByLabel("Body", { exact: true })
    .fill("Real editable document content");
  await page
    .getByRole("button", { name: "Create document", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Launch Notes");
  await page.waitForURL((url) =>
    /\/documents\/[0-9a-f-]{36}$/.test(url.pathname),
  );
  const documentId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  await page.reload();
  await expect(
    page.getByText("Real editable document content", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "docs/evidence/ui-document-desktop.png" });
  // Real Hono stale edit token rejects the second writer snapshot without corrupting saved content.
  const stale = await page.evaluate(
    async ({ workspaceId, documentId }) => {
      const path = `/api/workspaces/${workspaceId}/documents/${documentId}`;
      const doc = await (await fetch(path)).json();
      const edit = (title: string) =>
        fetch(path, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, editToken: doc.editToken }),
        });
      return [
        (await edit("Acknowledged title")).status,
        (await edit("Stale title")).status,
      ];
    },
    { workspaceId, documentId },
  );
  expect(stale).toEqual([200, 409]);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Acknowledged title");
  const persisted = await page.evaluate(
    async ({ workspaceId, taskId }) =>
      (
        await (
          await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}`)
        ).json()
      ).title,
    { workspaceId, taskId },
  );
  expect(persisted).toBe("Verify Launch Task");
  expect(errors).toEqual([]);
});
