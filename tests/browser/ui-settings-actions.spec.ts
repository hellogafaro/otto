import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { connections } from "../../packages/connections/src/schema";
import { qualifySubscription } from "../../packages/subscriptions/src/server";
import { inWorkspace } from "../../packages/workspaces/src";
import { invitations, users } from "../../packages/workspaces/src/schema";
import { register } from "./account";
import { expect, test } from "./live-app";

function responseFor(page: Page, method: string, path: string) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path &&
      response.request().method() === method,
  );
}

async function openMcpCreation(page: Page, title: string) {
  await page
    .getByRole("button", { name: "New connection", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "New connection",
    exact: true,
  });
  await dialog.getByLabel("Name", { exact: true }).fill(title);
  await dialog
    .getByRole("button", { name: "Connection type: GitHub App", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "MCP server", exact: true })
    .click();
  await dialog
    .getByLabel("Account association", { exact: true })
    .fill(`qa:${crypto.randomUUID()}`);
  return dialog;
}

test("Members save real roles, reject viewer writes, remove members and manage known invitation IDs", async ({
  page,
  fixture,
  browser,
}, testInfo) => {
  const { workspaceId } = await register(
    page,
    fixture,
    "Settings Membership Owner",
  );
  const targetName = `Settings Membership Viewer ${crypto.randomUUID().slice(0, 8)}`;
  const other = await browser.newContext();
  try {
    const viewer = await other.newPage();
    const { userId } = await register(viewer, fixture, targetName, "viewer");
    await viewer.goto("/settings/members");
    await expect(
      viewer.getByRole("button", { name: "Invite", exact: true }),
    ).toHaveCount(0);
    await expect(
      viewer.getByRole("button", { name: "Remove", exact: true }),
    ).toHaveCount(0);
    const denied = await viewer.evaluate(
      async ({ workspaceId, userId }) => {
        const response = await fetch(
          `/api/workspaces/${workspaceId}/members/${userId}/role`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ role: "contributor" }),
          },
        );
        return response.status;
      },
      { workspaceId, userId },
    );
    expect(denied).toBe(403);

    await page.goto("/settings/members");
    const row = page.locator('[data-slot="item"]').filter({
      has: page.getByText(targetName, { exact: true }),
    });
    await row
      .getByRole("button", {
        name: `${targetName} role: Viewer`,
        exact: true,
      })
      .click();
    await page
      .getByRole("menuitemradio", { name: "Contributor", exact: true })
      .click();
    const roleAck = responseFor(
      page,
      "POST",
      `/api/workspaces/${workspaceId}/members/${userId}/role`,
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Change role", exact: true })
      .click();
    expect((await roleAck).status()).toBe(200);
    await expect(
      row.getByRole("button", {
        name: `${targetName} role: Contributor`,
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      row.getByRole("button", {
        name: `${targetName} role: Contributor`,
        exact: true,
      }),
    ).toBeVisible();
    await viewer.reload();
    await expect(
      viewer.getByRole("button", { name: "Invite", exact: true }),
    ).toHaveCount(0);
    await expect(
      viewer.getByRole("button", { name: "Remove", exact: true }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Invite", exact: true }).click();
    const invite = page.getByRole("dialog", {
      name: "Invite member",
      exact: true,
    });
    const email = `settings-invite-${crypto.randomUUID()}@example.test`;
    await invite.getByLabel("Email", { exact: true }).fill(email);
    const creationAck = responseFor(
      page,
      "POST",
      `/api/workspaces/${workspaceId}/invitations`,
    );
    await invite.getByRole("button", { name: "Invite", exact: true }).click();
    const creation = await creationAck;
    expect(creation.status()).toBe(200);
    const invitation = await creation.json();
    expect(invitation).toMatchObject({
      email,
      role: "contributor",
      delivery: "unavailable",
    });
    await expect(invite).not.toBeVisible();
    await expect(
      page.getByText(`Delivery: unavailable. Invitation ID: ${invitation.id}`, {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Invitation ID", { exact: true }).fill(invitation.id);
    const resendAck = responseFor(
      page,
      "POST",
      `/api/workspaces/${workspaceId}/invitations/${invitation.id}/send`,
    );
    await page.getByRole("button", { name: "Resend", exact: true }).click();
    expect((await resendAck).status()).toBe(200);
    await expect(
      page.getByText("Delivery: unavailable", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    const revokeAck = responseFor(
      page,
      "PATCH",
      `/api/workspaces/${workspaceId}/invitations/${invitation.id}`,
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Revoke", exact: true })
      .click();
    expect((await revokeAck).status()).toBe(200);
    const saved = await fixture.database.db
      .select({ revokedAt: invitations.revokedAt })
      .from(invitations)
      .where(eq(invitations.id, invitation.id))
      .limit(1);
    expect(saved[0]?.revokedAt).toBeInstanceOf(Date);
    const refusedResend = responseFor(
      page,
      "POST",
      `/api/workspaces/${workspaceId}/invitations/${invitation.id}/send`,
    );
    await page.getByRole("button", { name: "Resend", exact: true }).click();
    const revokedResponse = await refusedResend;
    expect(revokedResponse.status()).toBe(409);
    expect(await revokedResponse.json()).toMatchObject({ error: "conflict" });
    await expect(
      page.getByRole("alert").filter({ hasText: "This item changed." }),
    ).toBeVisible();
    await page
      .getByLabel("Accept invitation ID", { exact: true })
      .fill(invitation.id);
    const acceptAck = responseFor(
      page,
      "POST",
      `/api/invitations/${invitation.id}/accept`,
    );
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    expect((await acceptAck).status()).toBe(403);

    await row.getByRole("button", { name: "Remove", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Remove", exact: true }).click();
    const removeAck = responseFor(
      page,
      "DELETE",
      `/api/workspaces/${workspaceId}/members/${userId}`,
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove", exact: true })
      .click();
    expect((await removeAck).status()).toBe(200);
    await expect(row).toHaveCount(0);
    await viewer.reload();
    await expect(
      viewer.getByText("No workspace access.", { exact: false }),
    ).toBeVisible();
    await testInfo.attach("members-and-unavailable-invitation-delivery", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await other.close();
  }
});

test("Known invitation acceptance uses the verified exact recipient and consumes only that ID", async ({
  page,
  fixture,
  browser,
}, testInfo) => {
  const { workspaceId } = await register(
    page,
    fixture,
    "Settings Invitation Owner",
  );
  const other = await browser.newContext();
  try {
    const recipient = await other.newPage();
    const { userId } = await register(
      recipient,
      fixture,
      "Settings Invitation Recipient",
      "viewer",
    );
    const email = await recipient.evaluate(
      async () =>
        (await (await fetch("/api/auth/get-session")).json()).user
          .email as string,
    );
    // Controlled fixture verification only: this app has no mail sender. This
    // proves recipient/acceptance authorization, not delivery or email verification.
    await fixture.database.db
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.id, userId));
    await recipient.reload();
    await page.goto("/settings/members");
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Invite member",
      exact: true,
    });
    await dialog.getByLabel("Email", { exact: true }).fill(email);
    const creationAck = responseFor(
      page,
      "POST",
      `/api/workspaces/${workspaceId}/invitations`,
    );
    await dialog.getByRole("button", { name: "Invite", exact: true }).click();
    const invitation = await (await creationAck).json();
    await expect(dialog).not.toBeVisible();
    await page
      .getByLabel("Accept invitation ID", { exact: true })
      .fill(invitation.id);
    const wrongRecipient = responseFor(
      page,
      "POST",
      `/api/invitations/${invitation.id}/accept`,
    );
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    expect((await wrongRecipient).status()).toBe(403);
    await recipient.goto("/settings/members");
    await recipient
      .getByLabel("Accept invitation ID", { exact: true })
      .fill(invitation.id);
    const accepted = responseFor(
      recipient,
      "POST",
      `/api/invitations/${invitation.id}/accept`,
    );
    await recipient
      .getByRole("button", { name: "Accept", exact: true })
      .click();
    const result = await accepted;
    expect(result.status()).toBe(200);
    expect(await result.json()).toEqual({ workspaceId });
    await recipient.waitForURL((url) => url.pathname === "/");
    const saved = await fixture.database.db
      .select({ acceptedAt: invitations.acceptedAt })
      .from(invitations)
      .where(eq(invitations.id, invitation.id))
      .limit(1);
    expect(saved[0]?.acceptedAt).toBeInstanceOf(Date);
    // Existing membership is retained: accepting a new invite must not promote it.
    const member = await recipient.evaluate(
      async ({ workspaceId, userId }) =>
        (
          await (
            await fetch(`/api/workspaces/${workspaceId}/members?limit=100`)
          ).json()
        ).items.find((entry: { userId: string }) => entry.userId === userId),
      { workspaceId, userId },
    );
    expect(member.role).toBe("viewer");
    await recipient.goto("/settings/members");
    await recipient
      .getByLabel("Accept invitation ID", { exact: true })
      .fill(invitation.id);
    const repeated = responseFor(
      recipient,
      "POST",
      `/api/invitations/${invitation.id}/accept`,
    );
    await recipient
      .getByRole("button", { name: "Accept", exact: true })
      .click();
    expect((await repeated).status()).toBe(403);
    await expect(recipient.getByRole("alert")).toContainText(
      "You do not have permission",
    );
    await testInfo.attach("known-invitation-recipient-and-repeat-denial", {
      body: await recipient.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await other.close();
  }
});

test("Exact Codex account persists display and visibility, reports missing login/models services, and disables", async ({
  page,
  fixture,
  browser,
}, testInfo) => {
  const { workspaceId, userId } = await register(
    page,
    fixture,
    "Settings Account Owner",
  );
  await page.goto("/settings/models?status=disabled");
  await page.getByRole("button", { name: "New account", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New account", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill("Settings Exact Codex");
  const creationAck = responseFor(
    page,
    "POST",
    `/api/workspaces/${workspaceId}/subscriptions`,
  );
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const creation = await creationAck;
  expect(creation.status()).toBe(200);
  const account = await creation.json();
  expect(account).toMatchObject({
    provider: "codex",
    status: "needs_auth",
    visibility: "user",
    createdBy: userId,
  });
  await page.waitForURL(
    (url) => url.searchParams.get("account") === account.id,
  );
  await expect(
    page.getByText("Codex · Needs authentication · Only creator", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Models", exact: true }),
  ).toBeDisabled();
  const loginAck = responseFor(
    page,
    "POST",
    `/api/workspaces/${workspaceId}/subscriptions/${account.id}/login`,
  );
  await page.getByRole("button", { name: "Authenticate", exact: true }).click();
  expect((await loginAck).status()).toBe(503);
  await expect(
    page.getByRole("alert").filter({ hasText: "This service is unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText("Codex · Needs authentication · Only creator", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Device code:", { exact: false })).toHaveCount(0);

  await page
    .getByRole("textbox", { name: "Settings Exact Codex name", exact: true })
    .fill("Settings Renamed Codex");
  const renameAck = responseFor(
    page,
    "PATCH",
    `/api/workspaces/${workspaceId}/subscriptions/${account.id}`,
  );
  await page
    .getByRole("textbox", { name: "Settings Exact Codex name", exact: true })
    .blur();
  expect((await renameAck).status()).toBe(200);
  await expect(
    page.getByRole("textbox", {
      name: "Settings Renamed Codex name",
      exact: true,
    }),
  ).toHaveValue("Settings Renamed Codex");
  await page
    .getByRole("button", {
      name: "Settings Renamed Codex visibility: Only you",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Workspace", exact: true })
    .click();
  const sharingAck = responseFor(
    page,
    "PATCH",
    `/api/workspaces/${workspaceId}/subscriptions/${account.id}`,
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Share", exact: true })
    .click();
  expect((await sharingAck).status()).toBe(200);
  await page.reload();
  await expect(
    page.getByText("Codex · Needs authentication · Workspace", { exact: true }),
  ).toBeVisible();

  const reader = await browser.newContext();
  try {
    const readerPage = await reader.newPage();
    await register(
      readerPage,
      fixture,
      "Settings Account Reader",
      "contributor",
    );
    await readerPage.goto(`/settings/models?account=${account.id}`);
    await expect(
      readerPage.getByText("Codex · Needs authentication · Workspace", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      readerPage.getByRole("button", { name: "Authenticate", exact: true }),
    ).toHaveCount(0);
    await expect(
      readerPage.getByRole("button", { name: "Disable", exact: true }),
    ).toHaveCount(0);
    const denied = await readerPage.evaluate(
      async ({ workspaceId, id }) =>
        (
          await fetch(`/api/workspaces/${workspaceId}/subscriptions/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Unauthorized rename" }),
          })
        ).status,
      { workspaceId, id: account.id },
    );
    expect(denied).toBe(403);
  } finally {
    await reader.close();
  }

  // Controlled server-only qualified state to reach the enabled-only Models widget.
  // This exercises no real gateway authentication, provider account or billing.
  await test.step("Controlled account qualification; actual gateway service remains absent", async () => {
    await inWorkspace(fixture.database.db, workspaceId, { userId }, (ctx) =>
      qualifySubscription(ctx, account.id, "codex"),
    );
  });
  await page.reload();
  const modelsAck = responseFor(
    page,
    "GET",
    `/api/workspaces/${workspaceId}/subscriptions/${account.id}/models`,
  );
  await page.getByRole("button", { name: "Models", exact: true }).click();
  expect((await modelsAck).status()).toBe(503);
  await expect(
    page.getByRole("alert").filter({ hasText: "This service is unavailable" }),
  ).toBeVisible();
  await expect(page.getByText("Available models", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText(/gpt-|claude-/)).toHaveCount(0);
  await page.getByRole("button", { name: "Disable", exact: true }).click();
  const disableAck = responseFor(
    page,
    "PATCH",
    `/api/workspaces/${workspaceId}/subscriptions/${account.id}`,
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Disable", exact: true })
    .click();
  expect((await disableAck).status()).toBe(200);
  await expect(
    page.getByText("Codex · Disabled · Workspace", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Codex · Disabled · Workspace", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Models", exact: true }),
  ).toBeDisabled();
  const current = await page.evaluate(
    async ({ workspaceId, id }) =>
      await (
        await fetch(`/api/workspaces/${workspaceId}/subscriptions/${id}`)
      ).json(),
    { workspaceId, id: account.id },
  );
  expect(current).toMatchObject({
    id: account.id,
    title: "Settings Renamed Codex",
    visibility: "workspace",
    status: "disabled",
  });
  await testInfo.attach("exact-account-disabled-no-model-fallback", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("MCP creation and configuration persist, missing discovery/connect services never imply connected", async ({
  page,
  fixture,
}, testInfo) => {
  const { workspaceId } = await register(
    page,
    fixture,
    "Settings Connection Owner",
  );
  await page.goto("/settings/connections?connected=true");
  const dialog = await openMcpCreation(page, "Settings Exact MCP");
  const creationAck = responseFor(
    page,
    "POST",
    `/api/workspaces/${workspaceId}/connections`,
  );
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const creation = await creationAck;
  expect(creation.status()).toBe(200);
  const connection = await creation.json();
  expect(connection).toMatchObject({
    type: "mcp",
    connected: false,
    visibility: "user",
  });
  await page.waitForURL(
    (url) => url.searchParams.get("connection") === connection.id,
  );
  await expect(
    page.getByRole("heading", { name: "Settings Exact MCP", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  const config = page.getByRole("dialog", {
    name: "Configure Settings Exact MCP",
    exact: true,
  });
  await config
    .getByRole("button", {
      name: "Configuration replacement: Credential reference",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Provider configuration", exact: true })
    .click();
  await config
    .getByLabel("MCP endpoint", { exact: true })
    .fill("https://mcp.example.test/otto");
  await config
    .getByLabel("Trusted tools", { exact: true })
    .fill("read_item target read");
  await config
    .getByLabel("Resource URIs", { exact: true })
    .fill("otto://qa/item");
  const configAck = responseFor(
    page,
    "PATCH",
    `/api/workspaces/${workspaceId}/connections/${connection.id}`,
  );
  await config
    .getByRole("button", { name: "Replace configuration", exact: true })
    .click();
  expect((await configAck).status()).toBe(200);
  await expect(config).not.toBeVisible();
  const saved = await fixture.database.db
    .select({
      config: connections.config,
      editToken: connections.editToken,
      connected: connections.connected,
    })
    .from(connections)
    .where(eq(connections.id, connection.id))
    .limit(1);
  expect(saved[0]).toMatchObject({
    connected: false,
    editToken: connection.editToken + 1,
    config: {
      type: "mcp",
      endpoint: "https://mcp.example.test/otto",
      tools: [{ name: "read_item", targetArgument: "target", readOnly: true }],
      resources: ["otto://qa/item"],
    },
  });
  await page.reload();
  for (const [button, operation] of [
    ["Discover", "discover"],
    ["Connect", "connect"],
  ] as const) {
    const unavailable = responseFor(
      page,
      "POST",
      `/api/workspaces/${workspaceId}/connections/${connection.id}/${operation}`,
    );
    await page.getByRole("button", { name: button, exact: true }).click();
    expect((await unavailable).status()).toBe(503);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "This service is unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByText("Disconnected · Only creator", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Grant access", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Discovered actions", { exact: true }),
    ).toHaveCount(0);
  }
  const current = await page.evaluate(
    async ({ workspaceId, id }) =>
      await (
        await fetch(`/api/workspaces/${workspaceId}/connections/${id}`)
      ).json(),
    { workspaceId, id: connection.id },
  );
  expect(current.connected).toBe(false);
  await testInfo.attach("mcp-real-config-unavailable-service", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

for (const kind of ["account", "connection", "invitation"] as const) {
  test(`Controlled lost ACK after real ${kind} commit never replays its creation POST`, async ({
    page,
    fixture,
  }, testInfo) => {
    const { workspaceId } = await register(
      page,
      fixture,
      `Settings Lost ACK ${kind}`,
    );
    const section =
      kind === "account"
        ? "models"
        : kind === "connection"
          ? "connections"
          : "members";
    const collection =
      kind === "account"
        ? "subscriptions"
        : kind === "connection"
          ? "connections"
          : "invitations";
    const path = `/api/workspaces/${workspaceId}/${collection}`;
    const title = `Settings Lost ACK ${kind} Record`;
    const email = `lost-${crypto.randomUUID()}@example.test`;
    const trigger =
      kind === "account"
        ? "New account"
        : kind === "connection"
          ? "New connection"
          : "Invite";
    const dialogName = kind === "invitation" ? "Invite member" : trigger;
    const submitName = kind === "invitation" ? "Invite" : "Create";
    let posts = 0;
    let savedId: string | undefined;
    // Controlled network failure only: forward to actual Hono/PostgreSQL first,
    // verify the server committed, then discard its response to this browser.
    await page.route(
      (url) => url.pathname === path,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        posts++;
        const committed = await route.fetch();
        expect(committed.status()).toBe(200);
        savedId = (await committed.json()).id;
        await route.abort("failed");
      },
    );
    await page.goto(`/settings/${section}`);
    const dialog =
      kind === "connection"
        ? await openMcpCreation(page, title)
        : page.getByRole("dialog", { name: dialogName, exact: true });
    if (kind !== "connection") {
      await page.getByRole("button", { name: trigger, exact: true }).click();
      await dialog
        .getByLabel(kind === "invitation" ? "Email" : "Name", { exact: true })
        .fill(kind === "invitation" ? email : title);
    }
    await dialog.getByRole("button", { name: submitName, exact: true }).click();
    await expect(
      dialog.getByText(
        "Unable to confirm creation. Check the current records; the request may already have created one.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: submitName, exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeEnabled();
    await expect(
      dialog.getByLabel(kind === "invitation" ? "Email" : "Name", {
        exact: true,
      }),
    ).toHaveValue(kind === "invitation" ? email : title);
    await dialog
      .getByLabel(kind === "invitation" ? "Email" : "Name", { exact: true })
      .press("Enter");
    expect(posts).toBe(1);
    expect(savedId).toMatch(/^[\da-f-]{36}$/);
    if (kind === "invitation") {
      const rows = await fixture.database.db
        .select({ id: invitations.id })
        .from(invitations)
        .where(eq(invitations.email, email))
        .limit(2);
      expect(rows).toEqual([{ id: savedId }]);
      await expect(
        page.getByText("Created invitation", { exact: true }),
      ).toHaveCount(0);
    } else {
      const rows = await page.evaluate(
        async (path) => (await (await fetch(`${path}?limit=100`)).json()).items,
        path,
      );
      expect(
        rows
          .filter((row: { title: string }) => row.title === title)
          .map((row: { id: string }) => row.id),
      ).toEqual([savedId]);
    }
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: trigger, exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: submitName, exact: true }),
    ).toBeDisabled();
    await dialog
      .getByLabel(kind === "invitation" ? "Email" : "Name", { exact: true })
      .press("Enter");
    expect(posts).toBe(1);
    await testInfo.attach(`lost-${kind}-ack-replay-blocked`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
}

test("Connection configuration keeps its draft and opening editToken across a real background policy refresh", async ({
  page,
  fixture,
}, testInfo) => {
  const { workspaceId } = await register(
    page,
    fixture,
    "Settings Stale Config Owner",
  );
  await page.goto("/settings/connections");
  const creation = await openMcpCreation(page, "Settings Stale MCP");
  const creationAck = responseFor(
    page,
    "POST",
    `/api/workspaces/${workspaceId}/connections`,
  );
  await creation.getByRole("button", { name: "Create", exact: true }).click();
  const connection = await (await creationAck).json();
  await page.waitForURL(
    (url) => url.searchParams.get("connection") === connection.id,
  );
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Configure Settings Stale MCP",
    exact: true,
  });
  // A reference name, never a secret value; no resolver/provider is configured.
  await dialog
    .getByLabel("Credential reference", { exact: true })
    .fill("qa:settings:unsaved-binding");
  const changed = await page.evaluate(
    async ({ workspaceId, id, editToken }) => {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/connections/${id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ visibility: "workspace", editToken }),
        },
      );
      return { status: response.status, record: await response.json() };
    },
    { workspaceId, id: connection.id, editToken: connection.editToken },
  );
  expect(changed.status).toBe(200);
  expect(changed.record.editToken).toBe(connection.editToken + 1);
  // Advance only browser freshness time; the refetch and stale rejection are real.
  await page.clock.install();
  await page.clock.fastForward(11_000);
  const refreshed = responseFor(
    page,
    "GET",
    `/api/workspaces/${workspaceId}/connections/${connection.id}`,
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  expect((await (await refreshed).json()).editToken).toBe(
    changed.record.editToken,
  );
  await expect(
    dialog.getByLabel("Credential reference", { exact: true }),
  ).toHaveValue("qa:settings:unsaved-binding");
  const staleAck = responseFor(
    page,
    "PATCH",
    `/api/workspaces/${workspaceId}/connections/${connection.id}`,
  );
  await dialog
    .getByRole("button", { name: "Replace configuration", exact: true })
    .click();
  const rejected = await staleAck;
  expect(rejected.status()).toBe(409);
  expect(rejected.request().postDataJSON().editToken).toBe(
    connection.editToken,
  );
  await expect(dialog.getByRole("alert")).toContainText("This item changed.");
  await expect(
    dialog.getByLabel("Credential reference", { exact: true }),
  ).toHaveValue("qa:settings:unsaved-binding");
  const saved = await fixture.database.db
    .select({
      credentialRef: connections.credentialRef,
      visibility: connections.visibility,
      editToken: connections.editToken,
    })
    .from(connections)
    .where(eq(connections.id, connection.id))
    .limit(1);
  expect(saved[0]).toEqual({
    credentialRef: null,
    visibility: "workspace",
    editToken: changed.record.editToken,
  });
  await testInfo.attach("stale-config-draft-and-opening-token-retained", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
