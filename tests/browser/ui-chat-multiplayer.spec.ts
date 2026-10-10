import { test as base, expect } from "@playwright/test";
import { z } from "zod";
import { startStreamingApp } from "../fixtures/streaming-app";

const test = base.extend<{
  fixture: Awaited<ReturnType<typeof startStreamingApp>>;
}>({
  fixture: [
    async ({ playwright: _playwright }, use) => {
      const fixture = await startStreamingApp("http://127.0.0.1:45293");
      const web = Bun.spawn(
        [
          process.execPath,
          "--no-env-file",
          "node_modules/vite/bin/vite.js",
          "--host",
          "127.0.0.1",
          "--port",
          "45293",
          "--strictPort",
        ],
        {
          cwd: `${process.cwd()}/apps/web`,
          env: { ...process.env, OTTO_API_ORIGIN: fixture.apiOrigin },
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      try {
        await expect
          .poll(async () => (await fetch(fixture.origin).catch(() => null))?.ok)
          .toBe(true);
        await use(fixture);
      } finally {
        web.kill("SIGTERM");
        await web.exited;
        await fixture.stop();
      }
    },
    { timeout: 120000 },
  ],
});

test.use({
  baseURL: "http://127.0.0.1:45293",
  launchOptions: { executablePath: process.env.OTTO_TEST_CHROMIUM },
});

test("human and agent combinations use automatic one-to-one replies and explicit group mentions", async ({
  page,
  browser,
  fixture,
}, testInfo) => {
  test.setTimeout(180000);
  const owner = await fixture.register("Human Owner");
  const peer = await fixture.register("Human Peer");
  const { agentIds, workspaceId } = await fixture.setup(owner.id, peer.id);
  await page.context().addCookies([
    {
      name: owner.cookie.slice(0, owner.cookie.indexOf("=")),
      value: owner.cookie.slice(owner.cookie.indexOf("=") + 1),
      url: fixture.origin,
    },
  ]);
  const clientAdmissions: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/runs")
    )
      clientAdmissions.push(request.url());
  });
  const runPage = z.object({
    items: z.array(
      z.object({ id: z.string(), agentId: z.string(), state: z.string() }),
    ),
  });
  const getRuns = async (chatId: string) =>
    runPage.parse(
      await (
        await fixture.request(owner.cookie, `/runs?chatId=${chatId}&limit=100`)
      ).json(),
    ).items;
  const complete = async (ids: string[]) => {
    for (const id of ids) {
      await expect
        .poll(() => fixture.controls.has(id), { timeout: 20000 })
        .toBe(true);
      fixture.controls.get(id)?.delta(" completed.");
      fixture.controls.get(id)?.finish();
      await expect
        .poll(
          async () =>
            (await (await fixture.request(owner.cookie, `/runs/${id}`)).json())
              .state,
        )
        .toBe("finished");
    }
  };
  const rooms = new Map<string, string>();
  for (const [humans, agents] of [
    [1, 0],
    [2, 0],
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
  ]) {
    const title = `${humans} human ${agents} agent`;
    const created = await fixture.request(owner.cookie, "/chats", {
      title,
      visibility: "participants",
    });
    expect(created.status).toBe(200);
    const chatId = z.object({ id: z.string() }).parse(await created.json()).id;
    rooms.set(`${humans}:${agents}`, chatId);
    if (humans === 2)
      expect(
        (
          await fixture.request(owner.cookie, `/chats/${chatId}/participants`, {
            userId: peer.id,
            role: "contributor",
          })
        ).status,
      ).toBe(200);
    for (const agentId of agentIds.slice(0, agents))
      expect(
        (
          await fixture.request(owner.cookie, `/chats/${chatId}/participants`, {
            agentId,
            role: "contributor",
          })
        ).status,
      ).toBe(200);
    await page.goto(`/chats/${chatId}`);
    const editor = page.getByLabel(`Message ${title}, @ to tag`);
    await editor.fill(`Quiet message in ${title}`);
    await expect(page.getByRole("button", { name: /^Send to:/ })).toHaveCount(
      0,
    );
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/chats/${chatId}/messages`),
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    expect((await (await saved).json()).replyErrors).toEqual([]);
    const selected = await getRuns(chatId);
    expect(selected.map((run) => run.agentId)).toEqual(
      humans === 1 && agents === 1 ? [agentIds[0]] : [],
    );
    await complete(selected.map((run) => run.id));
    await page.reload();
    await expect(
      page
        .getByRole("log")
        .getByText(`Quiet message in ${title}`, { exact: true }),
    ).toBeVisible();
  }

  for (const key of ["1:2", "2:1", "2:2"]) {
    const chatId = rooms.get(key);
    if (!chatId) throw new Error("Missing test room");
    await page.goto(`/chats/${chatId}`);
    const editor = page.getByRole("textbox", { name: /^Message / });
    await editor.pressSequentially("@Stream");
    await page
      .getByRole("option", { name: "Stream Alpha", exact: true })
      .click();
    await editor.pressSequentially(" please reply.");
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/chats/${chatId}/messages`),
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    expect((await (await saved).json()).replyErrors).toEqual([]);
    const selected = await getRuns(chatId);
    expect(selected.map((run) => run.agentId)).toEqual([agentIds[0]]);
    await complete(selected.map((run) => run.id));
  }

  const groupId = rooms.get("2:2");
  if (!groupId) throw new Error("Missing multiplayer room");
  const editor = page.getByRole("textbox", { name: /^Message / });
  for (const label of ["Stream Alpha", "Stream Beta", "Stream Alpha"]) {
    await editor.pressSequentially("@Stream");
    await page.getByRole("option", { name: label, exact: true }).click();
  }
  await editor.pressSequentially(" both reply once.");
  const before = await getRuns(groupId);
  let interrupted = false;
  await page.route(
    `**/workspaces/${workspaceId}/chats/${groupId}/messages`,
    async (route) => {
      if (route.request().method() !== "POST" || interrupted)
        return route.continue();
      interrupted = true;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    },
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Delivery is unconfirmed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(editor).toBeEmpty();
  const retried = (await getRuns(groupId)).filter(
    (run) => !before.some((old) => old.id === run.id),
  );
  expect(retried.map((run) => run.agentId).sort()).toEqual(
    [...agentIds].sort(),
  );
  await complete(retried.map((run) => run.id));
  await page.reload();
  const history = z
    .array(z.object({ authorAgentId: z.string().nullable(), body: z.string() }))
    .parse(
      await (
        await fixture.request(owner.cookie, `/chats/${groupId}/messages`)
      ).json(),
    );
  expect(
    history.filter(
      (message) =>
        message.authorAgentId === null &&
        message.body.includes("both reply once."),
    ),
  ).toHaveLength(1);
  expect((await getRuns(groupId)).length).toBe(before.length + 2);
  expect(clientAdmissions).toEqual([]);
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  await expect(
    page
      .getByRole("log")
      .getByText("both reply once.", { exact: false })
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("mention-driven-multiplayer.png"),
  });

  const peerContext = await browser.newContext({ baseURL: fixture.origin });
  try {
    await peerContext.addCookies([
      {
        name: peer.cookie.slice(0, peer.cookie.indexOf("=")),
        value: peer.cookie.slice(peer.cookie.indexOf("=") + 1),
        url: fixture.origin,
      },
    ]);
    const peerPage = await peerContext.newPage();
    await peerPage.goto(`/chats/${groupId}`);
    const peerEditor = peerPage.getByRole("textbox", { name: /^Message / });
    await peerEditor.pressSequentially("@Human");
    await peerPage.getByRole("option", { name: /Human Owner$/ }).click();
    await peerEditor.pressSequentially(" a message for you, not the agents.");
    const saved = peerPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/chats/${groupId}/messages`),
    );
    await peerPage.getByRole("button", { name: "Send", exact: true }).click();
    expect((await (await saved).json()).replyErrors).toEqual([]);
    expect((await getRuns(groupId)).length).toBe(before.length + 2);
    await expect(
      page.getByText("a message for you, not the agents.", { exact: false }),
    ).toBeVisible();
  } finally {
    await peerContext.close();
  }
});
