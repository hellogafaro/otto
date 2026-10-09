import { register } from "./account";
import { expect, test } from "./live-app";

test("Viewer and nonmember authority, workspace switching and profile persistence", async ({
  page,
  fixture,
  browser,
}) => {
  const { userId, workspaceId } = await register(
    page,
    fixture,
    "Permission Owner",
  );
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("First workspace only");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL((url) =>
    /\/projects\/[0-9a-f-]{36}$/.test(url.pathname),
  );
  const projectId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  const viewer = await browser.newContext();
  try {
    const viewerPage = await viewer.newPage();
    await register(viewerPage, fixture, "Permission Viewer", "viewer");
    await page.getByRole("button", { name: "Add member", exact: true }).click();
    await page
      .getByRole("button", { name: "Choose member", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", { name: "Permission Viewer", exact: true })
      .click();
    // New Project members default to Viewer; keep that explicit least-authority choice.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add member", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Add project member" }),
    ).not.toBeVisible();
    await viewerPage.goto("/projects");
    await expect(
      viewerPage.getByText("First workspace only", { exact: true }),
    ).toBeVisible();
    await expect(
      viewerPage.getByRole("button", { name: "New project", exact: true }),
    ).toHaveCount(0);
    const denied = await viewerPage.evaluate(
      async ({ workspaceId, projectId }) =>
        (
          await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Forbidden edit" }),
          })
        ).status,
      { workspaceId, projectId },
    );
    expect(denied).toBe(403);
    await viewerPage.screenshot({
      path: "docs/evidence/ui-viewer-projects.png",
    });
  } finally {
    await viewer.close();
  }
  const outsider = await browser.newContext();
  try {
    // Additional private fixture identities use Better Auth directly, preserving its HTTP signup rate limit.
    const response = await fixture.auth.api.signUpEmail({
      body: {
        name: "Nonmember",
        email: `outside-${crypto.randomUUID()}@example.test`,
        password: crypto.randomUUID() + crypto.randomUUID(),
      },
      asResponse: true,
    });
    expect(response.ok).toBe(true);
    for (const header of response.headers.getSetCookie()) {
      const cookie = header.split(";")[0];
      if (!cookie) continue;
      const separator = cookie.indexOf("=");
      await outsider.addCookies([
        {
          name: cookie.slice(0, separator),
          value: cookie.slice(separator + 1),
          url: fixture.origin,
          httpOnly: true,
        },
      ]);
    }
    const outsiderPage = await outsider.newPage();
    await outsiderPage.goto("/");
    await expect(
      outsiderPage.getByText("No workspace access.", { exact: false }),
    ).toBeVisible();
    const denied = await outsiderPage.evaluate(
      async ({ workspaceId, projectId }) =>
        (await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}`))
          .status,
      { workspaceId, projectId },
    );
    expect([403, 404]).toContain(denied);
  } finally {
    await outsider.close();
  }
  await page.goto("/settings/profile");
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Saved Profile Owner");
  await page.getByRole("textbox", { name: "Name", exact: true }).blur();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await (await fetch("/api/auth/get-session")).json()).user.name,
      ),
    )
    .toBe("Saved Profile Owner");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Saved Profile Owner");
  const second = await fixture.secondWorkspace(userId);
  await page.reload();
  await page
    .getByRole("button", { name: "Open profile menu", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Otto walkthrough", exact: true })
    .hover();
  await page
    .getByRole("menuitemradio", { name: "Second workspace", exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto("/projects");
  await expect(
    page.getByText("First workspace only", { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("otto-workspace")),
  ).toBe(second);
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole("alert")).toContainText(
    "This item is no longer available.",
  );
  await page.screenshot({ path: "docs/evidence/ui-workspace-isolation.png" });
});

test("Every main route renders desktop and mobile in both themes; list failures retry", async ({
  page,
  fixture,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await register(page, fixture, "Visual Owner");
  const routes = [
    "/",
    "/tasks",
    "/projects",
    "/documents",
    "/files",
    "/chats",
    "/schedules",
    "/settings/profile",
    "/settings/notifications",
    "/settings/models",
    "/settings/connections",
    "/settings/agents",
    "/settings/workspace",
    "/settings/members",
  ];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => localStorage.setItem("theme", theme), theme);
    for (const mobile of [false, true]) {
      await page.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      );
      for (const route of routes) {
        await page.goto(route);
        await page
          .getByRole("button", { name: "Open profile menu", exact: true })
          .waitFor();
        await expect(page.locator("html")).toHaveClass(new RegExp(theme));
        await expect(
          page.getByRole("status", { name: "Loading", exact: true }),
        ).toHaveCount(0);
        await expect(page.getByRole("alert")).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `docs/evidence/ui-${route === "/" ? "inbox" : route.slice(1).replaceAll("/", "-")}-${mobile ? "mobile" : "desktop"}-${theme}.png`,
        });
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route("**/projects?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"unavailable"}',
    }),
  );
  await page.goto("/projects");
  await expect(page.getByRole("alert")).toContainText(
    "This service is unavailable,",
  );
  await page.unroute("**/projects?*");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New project", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
