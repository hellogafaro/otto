import { projectMembers } from "../../packages/projects/src/schema";
import { members, users } from "../../packages/workspaces/src/schema";
import { register } from "./account";
import { expect, test } from "./live-app";

test("Current Project contributor after the first hundred keeps Task and Document write access", async ({
  page,
  fixture,
}) => {
  const { workspaceId, userId } = await register(
    page,
    fixture,
    "ZZ Authority Owner",
  );
  const records = await page.evaluate(async (workspaceId) => {
    const request = async (domain: string, body: object) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/${domain}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new Error(`Fixture creation failed: ${response.status}`);
      return response.json();
    };
    const project = await request("projects", {
      title: "Paged Authority Project",
    });
    const task = await request("tasks", {
      projectId: project.id,
      title: "Paged Authority Task",
    });
    const document = await request("documents", {
      projectId: project.id,
      title: "Paged Authority Document",
      body: "Current author content",
      visibility: "workspace",
    });
    return {
      projectId: project.id as string,
      taskId: task.id as string,
      documentId: document.id as string,
    };
  }, workspaceId);
  // Population is fixture-only; reads and all permission decisions use real Hono/PostgreSQL.
  const population = Array.from({ length: 105 }, (_, index) => ({
    id: `!page-${crypto.randomUUID()}-${index}`,
    name: `A Page ${index}`,
    email: `page-${crypto.randomUUID()}@example.test`,
  }));
  await fixture.database.db.insert(users).values(population);
  await fixture.database.db
    .insert(members)
    .values(
      population.map(({ id }) => ({
        workspaceId,
        userId: id,
        role: "contributor" as const,
      })),
    );
  await fixture.database.db
    .insert(projectMembers)
    .values(
      population.map(({ id }) => ({
        projectId: records.projectId,
        userId: id,
        role: "contributor" as const,
      })),
    );
  const first = await page.evaluate(
    async ({ workspaceId, projectId }) =>
      await (
        await fetch(
          `/api/workspaces/${workspaceId}/projects/${projectId}/members?limit=100`,
        )
      ).json(),
    { workspaceId, projectId: records.projectId },
  );
  expect(first.items).toHaveLength(100);
  expect(
    first.items.some((member: { userId: string }) => member.userId === userId),
  ).toBe(false);
  expect(first.next).toBeTruthy();
  await page.goto(`/tasks/${records.taskId}`);
  await expect(
    page.getByRole("button", { name: "Edit task", exact: true }),
  ).toBeEnabled();
  await page.goto(`/documents/${records.documentId}`);
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toBeEditable();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Paged Authority Saved");
  await page.getByRole("button", { name: "Save document", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Paged Authority Saved");
  await page.screenshot({ path: "docs/evidence/ui-authority-after100.png" });
});
