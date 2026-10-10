import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { hc } from "hono/client";
import type { RpcApp } from "../../apps/server/src/api";
import { participants } from "../../packages/chats/src/schema";
import { members, users } from "../../packages/workspaces/src/schema";
import { register } from "./account";
import { expect, test } from "./live-app";

// Authenticated real Hono requests share the browser's cookies and Origin boundary.
// Only explicit fault injections are intercepted; successful reads/writes hit PostgreSQL.
function api(page: Page, origin: string) {
  return hc<RpcApp>(`${origin}/api`, {
    fetch: async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const response = await page.request.fetch(String(input), {
        method: init?.method,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          origin,
        },
        data: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(await response.text(), {
        status: response.status(),
        headers: response.headers(),
      });
    },
  }).workspaces[":workspaceId"];
}

async function ack<T>(response: {
  ok: boolean;
  status: number;
  json(): Promise<T>;
}) {
  expect(response.status).toBe(200);
  expect(response.ok).toBe(true);
  return response.json();
}

async function openPanel(page: Page) {
  const open = page.getByRole("button", { name: "Open panel", exact: true });
  if (await open.isVisible()) await open.click();
  await expect(
    page.getByRole("button", { name: "Close panel", exact: true }),
  ).toBeVisible();
}

async function createChatInUi(page: Page, body: string) {
  await page.goto("/chats/new");
  const composer = page.getByRole("textbox", {
    name: "Write your first message",
    exact: true,
  });
  await expect(composer).toHaveAttribute("contenteditable", "true");
  await composer.fill(body);
  await composer.press("Enter");
  await page.waitForURL((url) => /\/chats\/[0-9a-f-]{36}$/.test(url.pathname));
  const chatId = new URL(page.url()).pathname.split("/").at(-1);
  if (!chatId) throw new Error("Acknowledged Chat URL is missing its ID");
  await expect(
    page.getByRole("log").getByText(body, { exact: true }),
  ).toBeVisible();
  return chatId;
}

test("Chat create, failed rename recovery, archive and restore persist real state", async ({
  page,
  fixture,
}, testInfo) => {
  const { workspaceId } = await register(page, fixture, "Chat Action Owner");
  const client = api(page, fixture.origin);
  const chatId = await createChatInUi(page, "Chat lifecycle proof");
  const param = { workspaceId, id: chatId };
  const saved = await ack(await client.chats[":id"].$get({ param }));
  expect(saved.title).toBe("Chat lifecycle proof");
  expect(saved.visibility).toBe("participants");
  expect(saved.archived).toBe(false);

  await page.getByRole("button", { name: saved.title, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rename chat", exact: true });
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Acknowledged renamed chat");
  const chatPath = `**/workspaces/${workspaceId}/chats/${chatId}`;
  await page.route(chatPath, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "unavailable" } })
      : route.continue(),
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "This service is unavailable",
  );
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
    "Acknowledged renamed chat",
  );
  expect((await ack(await client.chats[":id"].$get({ param }))).title).toBe(
    saved.title,
  );
  await page.unroute(chatPath);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Acknowledged renamed chat",
      exact: true,
    }),
  ).toBeEnabled();
  expect((await ack(await client.chats[":id"].$get({ param }))).title).toBe(
    "Acknowledged renamed chat",
  );

  await page.getByRole("button", { name: "Chat actions", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: /pin|snooze|mark.*done/i }),
  ).toHaveCount(0);
  await page
    .getByRole("menuitem", { name: "Archive chat", exact: true })
    .click();
  await expect(
    page.getByText("Archived. New Runs are unavailable", { exact: false }),
  ).toBeVisible();
  expect((await ack(await client.chats[":id"].$get({ param }))).archived).toBe(
    true,
  );
  const active = await ack(
    await client.chats.$get({
      param: { workspaceId },
      query: { limit: "100", archived: "false" },
    }),
  );
  expect(active.items.some((chat) => chat.id === chatId)).toBe(false);
  await page.reload();
  await expect(
    page.getByText("Archived. New Runs are unavailable", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Chat actions", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Restore chat", exact: true })
    .click();
  await expect(
    page.getByText("Archived. New Runs are unavailable", { exact: false }),
  ).toHaveCount(0);
  expect((await ack(await client.chats[":id"].$get({ param }))).archived).toBe(
    false,
  );
  await page.screenshot({ path: testInfo.outputPath("chat-restored.png") });
});

test("Late explicit viewer fails closed through participant continuation error and recovery", async ({
  page,
  fixture,
  browser,
}, testInfo) => {
  const owner = await register(page, fixture, "Late Participant Owner");
  const readerContext = await browser.newContext();
  let release = () => {};
  try {
    const readerPage = await readerContext.newPage();
    // The workspace role can write; the later Chat viewer row is the actual cap.
    const reader = await register(
      readerPage,
      fixture,
      "Late Chat Viewer",
      "contributor",
    );
    const client = api(page, fixture.origin);
    const chat = await ack(
      await client.chats.$post({
        param: { workspaceId: owner.workspaceId },
        json: { title: "Late participant authority", visibility: "workspace" },
      }),
    );
    const param = { workspaceId: owner.workspaceId, id: chat.id };
    await ack(
      await client.chats[":id"].participants.$post({
        param,
        json: { userId: reader.userId, role: "viewer" },
      }),
    );
    const agent = (
      await ack(
        await client.agents.$post({
          param: { workspaceId: owner.workspaceId },
          json: {
            title: "Later unconfigured Agent",
            instructions: "Controlled UI selection only",
            model: "fixture",
            visibility: "workspace",
          },
        }),
      )
    ).agent;
    await ack(
      await client.chats[":id"].participants.$post({
        param,
        json: { agentId: agent.id, role: "contributor" },
      }),
    );
    // Admission caps100. Seed retained discovery state directly in this disposable DB,
    // preserving real identities/FKs and real Hono authorization/cursor responses.
    const fillers = Array.from({ length: 100 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `Retained participant ${index}`,
      email: `retained-${crypto.randomUUID()}@example.test`,
    }));
    await fixture.database.db.insert(users).values(fillers);
    await fixture.database.db.insert(members).values(
      fillers.map((user) => ({
        workspaceId: owner.workspaceId,
        userId: user.id,
        role: "contributor" as const,
      })),
    );
    const retained = await ack(
      await client.chats[":id"].participants.$get({
        param,
        query: { limit: "100" },
      }),
    );
    for (const row of retained.items) {
      const id =
        row.userId === owner.userId
          ? "00000000-0000-4000-8000-000000000000"
          : row.userId === reader.userId
            ? "f0000000-0000-4000-8000-000000000000"
            : "ff000000-0000-4000-8000-000000000000";
      await fixture.database.db
        .update(participants)
        .set({ id })
        .where(eq(participants.id, row.id));
    }
    await fixture.database.db.insert(participants).values(
      fillers.map((user, index) => ({
        id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        chatId: chat.id,
        userId: user.id,
        role: "contributor" as const,
      })),
    );
    const first = await ack(
      await client.chats[":id"].participants.$get({
        param,
        query: { limit: "100" },
      }),
    );
    expect(first.items).toHaveLength(100);
    expect(
      first.items.some(
        (row) => row.userId === reader.userId || row.agentId === agent.id,
      ),
    ).toBe(false);
    expect(first.next).not.toBeNull();

    await page.goto(`/chats/${chat.id}`);
    await openPanel(page);
    await expect(
      page.getByRole("button", { name: `Remove ${agent.title}`, exact: true }),
    ).toBeVisible();

    const continuations: string[] = [];
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const participantPath = `**/workspaces/${owner.workspaceId}/chats/${chat.id}/participants?*`;
    await readerPage.route(participantPath, async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("limit")).toBe("100");
      expect(url.searchParams.has("userId")).toBe(false);
      const after = url.searchParams.get("after");
      if (!after) return route.continue();
      continuations.push(after);
      await held;
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    });
    await readerPage.goto(`/chats/${chat.id}`);
    await expect.poll(() => continuations.length).toBeGreaterThan(0);
    await expect(
      readerPage.getByText("Checking your chat access…", { exact: true }),
    ).toBeVisible();
    const composer = readerPage.getByRole("textbox", {
      name: `Message ${chat.title}, @ to tag`,
      exact: true,
    });
    await expect(composer).toHaveCount(0);
    await expect(
      readerPage.getByRole("button", { name: chat.title, exact: true }),
    ).toBeDisabled();
    await readerPage
      .getByRole("button", { name: "Chat actions", exact: true })
      .click();
    await expect(
      readerPage.getByRole("menuitem", { name: "Archive chat", exact: true }),
    ).toBeDisabled();
    await readerPage.keyboard.press("Escape");
    await openPanel(readerPage);
    await expect(
      readerPage.getByRole("button", { name: "Start Run", exact: true }),
    ).toHaveCount(0);
    release();
    await expect(readerPage.getByRole("alert").first()).toContainText(
      "This service is unavailable",
    );
    await expect(composer).toHaveCount(0);
    await readerPage.unroute(participantPath);
    await readerPage
      .getByRole("button", { name: "Retry", exact: true })
      .first()
      .click();
    await expect(
      readerPage.getByText("This chat is read-only for you.", { exact: true }),
    ).toBeVisible();
    await expect(readerPage.getByRole("alert")).toHaveCount(0);
    await expect(composer).toHaveCount(0);
    await expect(
      readerPage.getByRole("button", { name: "Add participants", exact: true }),
    ).toHaveCount(0);
    const denied = await api(readerPage, fixture.origin).chats[
      ":id"
    ].messages.$post({
      param,
      json: { requestId: crypto.randomUUID(), body: "Denied viewer write" },
    });
    expect(denied.status).toBe(403);
    await readerPage.screenshot({
      path: testInfo.outputPath("late-viewer-denied.png"),
    });
    await page
      .getByRole("button", {
        name: "Role for Late Chat Viewer: Viewer",
        exact: true,
      })
      .click();
    await page
      .getByRole("option", { name: "Contributor", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Role for Late Chat Viewer: Contributor",
        exact: true,
      }),
    ).toBeEnabled();
    // The retained multi-page query learns the real role change through polling.
    await expect(composer).toBeVisible({ timeout: 15000 });
    await expect(
      readerPage.getByRole("button", { name: chat.title, exact: true }),
    ).toBeDisabled();
    await composer.fill("Promoted contributor acknowledged");
    await composer.press("Enter");
    await expect(
      readerPage
        .getByRole("log")
        .getByText("Promoted contributor acknowledged", { exact: true }),
    ).toBeVisible();
    const discussion = await ack(
      await client.chats[":id"].messages.$get({ param, query: { after: "0" } }),
    );
    expect(
      discussion.find(
        (message) => message.body === "Promoted contributor acknowledged",
      )?.authorUserId,
    ).toBe(reader.userId);
  } finally {
    release();
    await readerContext.close();
  }
});

test("Special-label first and later mentions render chips and retain real attention and retry identity", async ({
  page,
  fixture,
  browser,
}, testInfo) => {
  const owner = await register(page, fixture, "Mention Owner");
  const recipientContext = await browser.newContext();
  try {
    const recipientPage = await recipientContext.newPage();
    const label = "Alice ] Doe";
    const recipient = await register(
      recipientPage,
      fixture,
      label,
      "contributor",
    );
    await page.goto("/chats/new");
    await page
      .getByRole("button", { name: "With: Participants", exact: true })
      .click();
    await page.getByRole("option").filter({ hasText: label }).click();
    await page.keyboard.press("Escape");
    const firstComposer = page.getByRole("textbox", {
      name: "Write your first message",
      exact: true,
    });
    await firstComposer.fill("First special mention ");
    await firstComposer.pressSequentially("@Alice");
    await page
      .locator('[data-slot="suggestion-list"]')
      .getByRole("option")
      .filter({ hasText: label })
      .click();
    await firstComposer.press("Enter");
    await page.waitForURL((url) =>
      /\/chats\/[0-9a-f-]{36}$/.test(url.pathname),
    );
    const chatId = new URL(page.url()).pathname.split("/").at(-1);
    if (!chatId) throw new Error("Saved mention Chat URL is missing its ID");
    const param = { workspaceId: owner.workspaceId, id: chatId };
    const client = api(page, fixture.origin);
    const savedChat = await ack(await client.chats[":id"].$get({ param }));
    expect(savedChat.title).toBe(`First special mention ${label}`);
    await expect(
      page.getByRole("button", { name: savedChat.title, exact: true }),
    ).toBeEnabled();
    const savedFirst = await ack(
      await client.chats[":id"].messages.$get({ param, query: { after: "0" } }),
    );
    expect(savedFirst).toHaveLength(1);
    expect(savedFirst[0]?.mentionUserIds).toEqual([recipient.userId]);
    await expect(
      page.getByRole("log").getByText(label, { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("log").getByText(label, { exact: true }),
    ).toBeVisible();
    const attention = await ack(
      await api(recipientPage, fixture.origin).attention.$get({
        param: { workspaceId: owner.workspaceId },
        query: { mentionsOnly: "true", limit: "100" },
      }),
    );
    expect(
      attention.items
        .find((item) => item.chatId === chatId)
        ?.unread.map((message) => message.id),
    ).toContain(savedFirst[0]?.id);

    const composer = page
      .getByRole("group", { name: "Message composer", exact: true })
      .getByRole("textbox");
    await composer.fill("Later special mention ");
    await composer.pressSequentially("@Alice");
    await page
      .locator('[data-slot="suggestion-list"]')
      .getByRole("option")
      .filter({ hasText: label })
      .click();
    const attempts: { requestId: string; mentionUserIds: string[] }[] = [];
    let deny = true;
    const messagePath = `**/workspaces/${owner.workspaceId}/chats/${chatId}/messages`;
    await page.route(messagePath, (route) => {
      if (route.request().method() !== "POST") return route.continue();
      attempts.push(route.request().postDataJSON());
      return deny
        ? route.fulfill({ status: 503, json: { error: "unavailable" } })
        : route.continue();
    });
    await composer.press("Enter");
    await expect(
      page.getByRole("alert").filter({ hasText: "Delivery is unconfirmed" }),
    ).toBeVisible();
    await expect(composer).toContainText(label);
    expect(attempts[0]?.mentionUserIds).toEqual([recipient.userId]);
    expect(
      (
        await ack(
          await client.chats[":id"].messages.$get({
            param,
            query: { after: "0" },
          }),
        )
      ).length,
    ).toBe(1);
    deny = false;
    await composer.press("Enter");
    await expect(
      page.getByRole("log").getByText(label, { exact: true }),
    ).toHaveCount(2);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.requestId).toBe(attempts[0]?.requestId);
    expect(attempts[1]?.mentionUserIds).toEqual([recipient.userId]);
    await page.unroute(messagePath);
    await expect(composer).not.toContainText(label);
    await page.reload();
    const saved = await ack(
      await client.chats[":id"].messages.$get({ param, query: { after: "0" } }),
    );
    expect(saved).toHaveLength(2);
    expect(
      saved.every((message) =>
        message.mentionUserIds.includes(recipient.userId),
      ),
    ).toBe(true);
    const finalAttention = await ack(
      await api(recipientPage, fixture.origin).attention.$get({
        param: { workspaceId: owner.workspaceId },
        query: { mentionsOnly: "true", limit: "100" },
      }),
    );
    expect(
      finalAttention.items
        .find((item) => item.chatId === chatId)
        ?.unread.map((message) => message.id),
    ).toEqual(saved.map((message) => message.id));
    await page.screenshot({
      path: testInfo.outputPath("special-label-mentions.png"),
    });
  } finally {
    await recipientContext.close();
  }
});

test("Run admission stays unavailable without an eligible configured account and never falls back", async ({
  page,
  fixture,
}, testInfo) => {
  const { workspaceId } = await register(
    page,
    fixture,
    "Unavailable Run Owner",
  );
  const admitted: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/runs")
    )
      admitted.push(request.url());
  });
  const client = api(page, fixture.origin);
  const chatId = await createChatInUi(page, "Unavailable Run proof");
  await openPanel(page);
  const start = page.getByRole("button", { name: "Start Run", exact: true });
  await expect(start).toHaveCount(0);
  const agent = (
    await ack(
      await client.agents.$post({
        param: { workspaceId },
        json: {
          title: "No account configured",
          instructions: "Do not launch real compute",
          model: "fixture",
          visibility: "workspace",
        },
      }),
    )
  ).agent;
  expect(agent.subscriptionId).toBeNull();
  await ack(
    await client.chats[":id"].participants.$post({
      param: { workspaceId, id: chatId },
      json: { agentId: agent.id, role: "contributor" },
    }),
  );
  await page.reload();
  await openPanel(page);
  const composer = page.getByRole("textbox", { name: /^Message / });
  await composer.fill("Keep this explicit draft");
  await composer.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "Message saved" }),
  ).toBeVisible();
  await expect(composer).toHaveText("Keep this explicit draft");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Message saved" }),
  ).toBeVisible();
  const history = await ack(
    await client.chats[":id"].messages.$get({
      param: { workspaceId, id: chatId },
      query: {},
    }),
  );
  expect(
    history.filter((message) => message.body === "Keep this explicit draft"),
  ).toHaveLength(1);
  expect(admitted).toEqual([]);
  expect(
    (
      await ack(
        await client.runs.$get({
          param: { workspaceId },
          query: { chatId, limit: "100" },
        }),
      )
    ).items,
  ).toEqual([]);
  await ack(
    await client.chats[":id"].archive.$post({
      param: { workspaceId, id: chatId },
      json: { archived: true },
    }),
  );
  await page.reload();
  await openPanel(page);
  await expect(
    page.getByText("Archived. New Runs are unavailable", { exact: false }),
  ).toBeVisible();
  await expect(start).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("run-admission-unavailable.png"),
  });
});
