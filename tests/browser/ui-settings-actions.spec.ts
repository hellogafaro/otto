import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { connections } from "../../packages/connections/src/schema";
import { secrets } from "../../packages/secrets/src/schema";
import { authorizeSubscriptionModel } from "../../packages/subscriptions/src/server";
import {
  createInvitation,
  createInvitationToken,
  inWorkspace,
} from "../../packages/workspaces/src";
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
  const { workspaceId, userId: ownerId } = await register(
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
    const token = await inWorkspace(
      fixture.database.db,
      workspaceId,
      { userId: ownerId },
      (c) => createInvitationToken(c, invitation.id),
      false,
      fixture.cursors,
    );
    expect(invitation).not.toHaveProperty("token");
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
      page.getByRole("alert").filter({ hasText: "This item changed," }),
    ).toBeVisible();
    await page
      .getByLabel("Accept invitation ID", { exact: true })
      .fill(invitation.id);
    const acceptAck = responseFor(
      page,
      "POST",
      `/api/invitations/${invitation.id}/accept`,
    );
    await page.getByLabel("Invitation token", { exact: true }).fill(token);
    await expect(
      page.getByRole("button", { name: "Accept", exact: true }),
    ).toBeEnabled();
    await testInfo.attach("settings-private-invitation-token-masked", {
      body: await page.screenshot({
        path: testInfo.outputPath("settings-token-masked.png"),
      }),
      contentType: "image/png",
    });
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

test("Known invitation acceptance requires a masked token, preserves unverified membership and refuses replay", async ({
  page,
  fixture,
  browser,
}, testInfo) => {
  const { workspaceId, userId: ownerId } = await register(
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
    const token = await inWorkspace(
      fixture.database.db,
      workspaceId,
      { userId: ownerId },
      (c) => createInvitationToken(c, invitation.id),
      false,
      fixture.cursors,
    );
    expect(invitation).not.toHaveProperty("token");
    await expect(dialog).not.toBeVisible();
    await page
      .getByLabel("Accept invitation ID", { exact: true })
      .fill(invitation.id);
    const wrongRecipient = responseFor(
      page,
      "POST",
      `/api/invitations/${invitation.id}/accept`,
    );
    await expect(
      page.getByRole("button", { name: "Accept", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("Invitation token", { exact: true }),
    ).toHaveAttribute("type", "password");
    await page.getByLabel("Invitation token", { exact: true }).fill(token);
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    expect((await wrongRecipient).status()).toBe(403);
    await recipient.goto("/settings/members");
    await recipient
      .getByLabel("Accept invitation ID", { exact: true })
      .fill(invitation.id);
    const idOnly = await recipient.evaluate(
      async (id) =>
        (
          await fetch(`/api/invitations/${id}/accept`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          })
        ).status,
      invitation.id,
    );
    expect(idOnly).toBe(400);
    await recipient.getByLabel("Invitation token", { exact: true }).fill(token);
    await expect(
      recipient.getByRole("button", { name: "Accept", exact: true }),
    ).toBeEnabled();
    await testInfo.attach("settings-private-invitation-token-masked", {
      body: await recipient.screenshot({
        path: testInfo.outputPath("settings-token-masked.png"),
      }),
      contentType: "image/png",
    });
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
    expect(
      (
        await fixture.database.db
          .select()
          .from(users)
          .where(eq(users.id, userId))
      )[0]?.emailVerified,
    ).toBe(false);
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
    await recipient.getByLabel("Invitation token", { exact: true }).fill(token);
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

test("An unverified account joins from the no-workspace boundary only with a private invitation token", async ({
  page,
  fixture,
  browser,
}, testInfo) => {
  const { workspaceId, userId: ownerId } = await register(
    page,
    fixture,
    "Boundary Invitation Owner",
  );
  const other = await browser.newContext();
  try {
    const recipient = await other.newPage();
    const email = `boundary-${crypto.randomUUID()}@example.test`;
    await recipient.goto("/");
    await recipient
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await recipient
      .getByLabel("Name", { exact: true })
      .fill("Boundary Recipient");
    await recipient.getByLabel("Email", { exact: true }).fill(email);
    await recipient
      .getByLabel("Password", { exact: true })
      .fill(crypto.randomUUID() + crypto.randomUUID());
    await recipient
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      recipient.getByText("No workspace access.", { exact: false }),
    ).toBeVisible();
    const { invitation, token } = await inWorkspace(
      fixture.database.db,
      workspaceId,
      { userId: ownerId },
      async (c) => {
        const invitation = await createInvitation(c, { email, role: "viewer" });
        return {
          invitation,
          token: await createInvitationToken(c, invitation.id),
        };
      },
      true,
      fixture.cursors,
    );
    await recipient
      .getByLabel("Invitation ID", { exact: true })
      .fill(invitation.id);
    await expect(
      recipient.getByLabel("Invitation token", { exact: true }),
    ).toHaveAttribute("type", "password");
    await recipient
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(
      recipient.getByText("No workspace access.", { exact: false }),
    ).toBeVisible();
    expect(
      (
        await fixture.database.db
          .select()
          .from(invitations)
          .where(eq(invitations.id, invitation.id))
      )[0]?.acceptedAt,
    ).toBeNull();
    await recipient.getByLabel("Invitation token", { exact: true }).fill(token);
    await testInfo.attach("no-workspace-private-invitation-token-masked", {
      body: await recipient.screenshot({
        path: testInfo.outputPath("no-workspace-token-masked.png"),
      }),
      contentType: "image/png",
    });
    const accepted = responseFor(
      recipient,
      "POST",
      `/api/invitations/${invitation.id}/accept`,
    );
    await recipient
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    expect((await accepted).status()).toBe(200);
    await recipient
      .getByRole("button", { name: "Open profile menu", exact: true })
      .waitFor();
    await recipient.reload();
    await recipient
      .getByRole("button", { name: "Open profile menu", exact: true })
      .waitFor();
    const session = await recipient.evaluate(
      async () => (await (await fetch("/api/auth/get-session")).json()).user,
    );
    expect(session.emailVerified).toBe(false);
    await testInfo.attach(
      "private-token-no-workspace-acceptance-after-reload",
      {
        body: await recipient.screenshot({
          path: testInfo.outputPath(
            "registration-acceptance-authenticated-reload.png",
          ),
        }),
        contentType: "image/png",
      },
    );
  } finally {
    await other.close();
  }
});

test("Exact native provider persists encrypted key, display and visibility, selected models, disables and disconnects", async ({
  page,
  fixture,
  browser,
}, testInfo) => {
  const { workspaceId, userId } = await register(
    page,
    fixture,
    "Settings Account Owner",
  );
  await page.goto("/settings/models");
  await expect(
    page.getByRole("heading", { name: "No providers", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  const creationDialog = page.getByRole("dialog", {
    name: "Add provider",
    exact: true,
  });
  await creationDialog
    .getByLabel("Title", { exact: true })
    .fill("Settings OpenAI");
  await creationDialog
    .getByLabel("Model IDs", { exact: true })
    .fill("gpt-fixture, gpt-selected");
  const creationAck = responseFor(
    page,
    "POST",
    `/api/workspaces/${workspaceId}/subscriptions`,
  );
  await creationDialog
    .getByRole("button", { name: "Continue to API key", exact: true })
    .click();
  const creation = await creationAck;
  expect(creation.status()).toBe(200);
  const account = await creation.json();
  expect(account).toMatchObject({
    provider: "openai",
    protocol: "responses",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-fixture", "gpt-selected"],
    status: "needs_auth",
    visibility: "user",
    createdBy: userId,
  });
  expect(account).not.toHaveProperty("secretId");
  const keyDialog = page.getByRole("dialog", {
    name: "Set API key",
    exact: true,
  });
  await expect(
    keyDialog.getByLabel("API key", { exact: true }),
  ).toHaveAttribute("type", "password");
  await keyDialog
    .getByLabel("API key", { exact: true })
    .fill("fixture-browser-provider-key");
  const keyAck = responseFor(
    page,
    "PUT",
    `/api/workspaces/${workspaceId}/subscriptions/${account.id}/api-key`,
  );
  await keyDialog
    .getByRole("button", { name: "Save API key", exact: true })
    .click();
  const keyResponse = await keyAck;
  expect(keyResponse.status()).toBe(200);
  const keyProjection = await keyResponse.json();
  expect(keyProjection.status).toBe("enabled");
  expect(keyProjection).not.toHaveProperty("secretId");
  expect(JSON.stringify(keyProjection)).not.toContain(
    "fixture-browser-provider-key",
  );
  await expect(keyDialog).not.toBeVisible();
  await expect(
    page.getByText("openai · responses · Key saved", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Device code:", { exact: false })).toHaveCount(0);

  const firstIdentity = await inWorkspace(
    fixture.database.db,
    workspaceId,
    { userId },
    (c) => authorizeSubscriptionModel(c, account.id, "gpt-selected"),
  );
  const savedSecret = await fixture.database.db
    .select({ value: secrets.value })
    .from(secrets)
    .where(eq(secrets.id, firstIdentity.accountId));
  expect(savedSecret).toHaveLength(1);
  expect(savedSecret[0]?.value).not.toContain("fixture-browser-provider-key");

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit provider", exact: true });
  await edit
    .getByLabel("Title", { exact: true })
    .fill("Settings Renamed OpenAI");
  await edit
    .getByRole("button", { name: "Who can use it: Only you", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Workspace", exact: true })
    .click();
  const metadataAck = responseFor(
    page,
    "PATCH",
    `/api/workspaces/${workspaceId}/subscriptions/${account.id}`,
  );
  await edit
    .getByRole("button", { name: "Save provider", exact: true })
    .click();
  expect((await metadataAck).status()).toBe(200);
  await expect(edit).not.toBeVisible();
  await page.reload();
  const shared = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Workspace providers",
      exact: true,
    }),
  });
  await expect(
    shared.getByText("Settings Renamed OpenAI", { exact: true }),
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
    await readerPage.goto("/settings/models");
    await expect(
      readerPage.getByText("Settings Renamed OpenAI", { exact: true }),
    ).toBeVisible();
    await expect(
      readerPage.getByRole("button", { name: "Replace key", exact: true }),
    ).toHaveCount(0);
    await expect(
      readerPage.getByRole("button", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    const denied = await readerPage.evaluate(
      async ({ workspaceId, id }) => {
        const base = `/api/workspaces/${workspaceId}/subscriptions/${id}`;
        const patch = await fetch(base, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Unauthorized rename" }),
        });
        const key = await fetch(`${base}/api-key`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: "fixture-unauthorized-key" }),
        });
        const models = await fetch(`${base}/models`);
        const projection = await (await fetch(base)).json();
        return {
          patch: patch.status,
          key: key.status,
          models: await models.json(),
          projection,
        };
      },
      { workspaceId, id: account.id },
    );
    expect(denied.patch).toBe(403);
    expect(denied.key).toBe(403);
    expect(denied.models).toEqual({
      items: [{ id: "gpt-fixture" }, { id: "gpt-selected" }],
      next: null,
    });
    expect(denied.projection).not.toHaveProperty("secretId");
    expect(JSON.stringify(denied)).not.toContain(
      "fixture-browser-provider-key",
    );
  } finally {
    await reader.close();
  }

  await page.getByRole("button", { name: "Replace key", exact: true }).click();
  await expect(keyDialog.getByLabel("API key", { exact: true })).toHaveValue(
    "",
  );
  await keyDialog
    .getByLabel("API key", { exact: true })
    .fill("fixture-browser-replacement-key");
  const replacementAck = responseFor(
    page,
    "PUT",
    `/api/workspaces/${workspaceId}/subscriptions/${account.id}/api-key`,
  );
  await keyDialog
    .getByRole("button", { name: "Save API key", exact: true })
    .click();
  expect((await replacementAck).status()).toBe(200);
  await expect(keyDialog).not.toBeVisible();
  const nextIdentity = await inWorkspace(
    fixture.database.db,
    workspaceId,
    { userId },
    (c) => authorizeSubscriptionModel(c, account.id, "gpt-selected"),
  );
  expect(nextIdentity.accountId).not.toBe(firstIdentity.accountId);
  expect(
    await fixture.database.db
      .select()
      .from(secrets)
      .where(eq(secrets.id, firstIdentity.accountId)),
  ).toHaveLength(0);

  const defaults = await page.evaluate(
    async (workspaceId) =>
      (
        await (
          await fetch(`/api/workspaces/${workspaceId}/agents?limit=100`)
        ).json()
      ).items as { id: string; isDefault: boolean }[],
    workspaceId,
  );
  const defaultAgent = defaults.find((agent) => agent.isDefault);
  expect(defaultAgent).toBeDefined();
  if (!defaultAgent)
    throw new Error("Default agent missing from bootstrap fixture");
  await page.goto(`/settings/agents/${defaultAgent.id}`);
  await page.getByRole("button", { name: "Edit agent", exact: true }).click();
  const agentEditor = page.getByRole("dialog", {
    name: "Edit agent",
    exact: true,
  });
  await agentEditor.getByRole("button", { name: /^Account:/ }).click();
  await page
    .getByRole("menuitemradio", {
      name: "Settings Renamed OpenAI · openai",
      exact: true,
    })
    .click();
  await agentEditor.getByRole("button", { name: /^Model:/ }).click();
  await page
    .getByRole("menuitemradio", { name: "gpt-selected", exact: true })
    .click();
  const agentAck = responseFor(
    page,
    "PATCH",
    `/api/workspaces/${workspaceId}/agents/${defaultAgent.id}`,
  );
  await agentEditor
    .getByRole("button", { name: "Save agent", exact: true })
    .click();
  expect((await agentAck).status()).toBe(200);
  await expect(agentEditor).not.toBeVisible();
  await page.reload();
  await expect(page.getByText("gpt-selected", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Protected default", { exact: true }),
  ).toBeVisible();
  await page.goto("/settings/models");

  const disableAck = responseFor(
    page,
    "PATCH",
    `/api/workspaces/${workspaceId}/subscriptions/${account.id}`,
  );
  await page.getByRole("button", { name: "Disable", exact: true }).click();
  expect((await disableAck).status()).toBe(200);
  await expect(
    shared.getByText("openai · responses · disabled", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    shared.getByText("openai · responses · disabled", { exact: true }),
  ).toBeVisible();
  await expect(
    inWorkspace(fixture.database.db, workspaceId, { userId }, (c) =>
      authorizeSubscriptionModel(c, account.id, "gpt-selected"),
    ),
  ).rejects.toThrow("Provider or model unavailable");
  await testInfo.attach("native-provider-disabled-no-model-fallback", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  const disconnectAck = responseFor(
    page,
    "POST",
    `/api/workspaces/${workspaceId}/subscriptions/${account.id}/disconnect`,
  );
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  expect((await disconnectAck).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "No providers", exact: true }),
  ).toBeVisible();
  const current = await page.evaluate(
    async ({ workspaceId, id }) =>
      (
        await fetch(`/api/workspaces/${workspaceId}/subscriptions/${id}`)
      ).json(),
    { workspaceId, id: account.id },
  );
  expect(current).toMatchObject({
    status: "disconnected",
    title: "Settings Renamed OpenAI",
    visibility: "workspace",
  });
  expect(
    await fixture.database.db
      .select()
      .from(secrets)
      .where(eq(secrets.id, nextIdentity.accountId)),
  ).toHaveLength(0);
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

for (const kind of ["connection", "invitation"] as const) {
  test(`Controlled lost ACK after real ${kind} commit never replays its creation POST`, async ({
    page,
    fixture,
  }, testInfo) => {
    const { workspaceId } = await register(
      page,
      fixture,
      `Settings Lost ACK ${kind}`,
    );
    const section = kind === "connection" ? "connections" : "members";
    const collection = kind === "connection" ? "connections" : "invitations";
    const path = `/api/workspaces/${workspaceId}/${collection}`;
    const title = `Settings Lost ACK ${kind} Record`;
    const email = `lost-${crypto.randomUUID()}@example.test`;
    const trigger = kind === "connection" ? "New connection" : "Invite";
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
    const pageAction = page
      .locator("header")
      .filter({
        has: page.getByRole("heading", {
          name: kind === "connection" ? "Connections" : "Members",
          exact: true,
        }),
      })
      .getByRole("button", { name: trigger, exact: true });
    const dialog =
      kind === "connection"
        ? await openMcpCreation(page, title)
        : page.getByRole("dialog", { name: dialogName, exact: true });
    if (kind !== "connection") {
      await pageAction.click();
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
    await expect(dialog).not.toBeVisible();
    await pageAction.click();
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
  await expect(dialog.getByRole("alert")).toContainText("This item changed,");
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
