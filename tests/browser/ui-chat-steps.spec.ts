import { test as base, expect } from "@playwright/test";
import { startStreamingApp } from "../fixtures/streaming-app";

const test = base.extend<{
  fixture: Awaited<ReturnType<typeof startStreamingApp>>;
}>({
  fixture: [
    async ({ playwright: _playwright }, use) => {
      const fixture = await startStreamingApp("http://127.0.0.1:45287");
      const web = Bun.spawn(
        [
          process.execPath,
          "--no-env-file",
          "node_modules/vite/bin/vite.js",
          "--host",
          "127.0.0.1",
          "--port",
          "45287",
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
  baseURL: "http://127.0.0.1:45287",
  launchOptions: { executablePath: process.env.OTTO_TEST_CHROMIUM },
});

test("synthetic work receipts stay compact in both Chats while exact decisions, questions and Stop remain usable", async ({
  page,
  fixture,
}, testInfo) => {
  const errors: string[] = [];
  const usageRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/usage"))
      usageRequests.push(request.url());
  });
  const owner = await fixture.register("Synthetic Chat sponsor");
  const peer = await fixture.register("Synthetic Chat participant");
  const { workspaceId, chatId, agentIds } = await fixture.setup(
    owner.id,
    peer.id,
  );
  await page.context().addCookies([
    {
      name: owner.cookie.slice(0, owner.cookie.indexOf("=")),
      value: owner.cookie.slice(owner.cookie.indexOf("=") + 1),
      url: fixture.origin,
    },
  ]);
  expect(
    (
      await fixture.request(peer.cookie, `/chats/${chatId}/messages`, {
        body: "Synthetic UI fixture · no live provider. Please review the saved work.",
        requestId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  const runId = crypto.randomUUID();
  let state = "finished";
  let outcome = "completed";
  let sponsorId = owner.id;
  let includePending = false;
  let stopFails = true;
  const calls: { path: string; input: unknown }[] = [];
  const approved = ["Synthetic report", "Synthetic follow-up"].map((title) => ({
    id: crypto.randomUUID(),
    runId,
    toolCallId: crypto.randomUUID(),
    type: "document.create",
    digest: "synthetic-digest",
    status: "approved",
    proposedByAgentId: agentIds[0],
    resolvedBy: owner.id,
    resolvedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    input: {
      type: "document.create",
      title,
      body: "Exact synthetic document",
      visibility: "participants",
    },
    result: { id: crypto.randomUUID(), title },
  }));
  const firstAction = approved[0];
  if (!firstAction) throw new Error("Synthetic work action missing");
  const pending = {
    ...firstAction,
    id: crypto.randomUUID(),
    toolCallId: crypto.randomUUID(),
    status: "pending",
    resolvedBy: null as string | null,
    resolvedAt: null as string | null,
    result: null as unknown,
    input: { ...firstAction.input, title: "Exact pending synthetic action" },
  };
  const question = {
    id: crypto.randomUUID(),
    runId,
    workspaceId,
    requestId: "synthetic-question",
    type: "question",
    body: "Which synthetic report should I use?",
    answer: null as string | null,
    answeredBy: null as string | null,
    answeredAt: null as string | null,
    cursor: 1,
    createdAt: new Date().toISOString(),
  };
  await page.route(`**/workspaces/${workspaceId}/runs**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      calls.push({ path, input });
      if (path.endsWith("/stop")) {
        if (stopFails)
          return route.fulfill({ status: 503, json: { error: "unavailable" } });
        state = "interrupted";
        outcome = "stopped_or_authorization_revoked";
      } else if (path.endsWith("/resolve")) {
        pending.status = "approved";
        pending.resolvedBy = owner.id;
        pending.resolvedAt = new Date().toISOString();
        pending.result = { id: "synthetic-created-document" };
        return route.fulfill({ json: pending });
      }
      return route.fulfill({ json: { acknowledged: true } });
    }
    if (path.endsWith("/activity"))
      return route.fulfill({
        json: [
          ...(includePending ? [question] : []),
          {
            ...question,
            id: "legacy-output",
            cursor: 2,
            type: "output",
            body: "NEVER_SHOW_RAW_LOG_OR_REASONING",
          },
        ],
      });
    if (path.endsWith("/actions"))
      return route.fulfill({
        json: {
          items: [...approved, ...(includePending ? [pending] : [])],
          next: null,
        },
      });
    return route.fulfill({
      json: {
        items: [
          {
            id: runId,
            chatId,
            agentId: agentIds[0],
            sponsorId,
            state,
            outcome,
            sessionState: "continued",
            type: "prompt",
            taskId: null,
            cursor: 1,
            createdAt: new Date().toISOString(),
          },
        ],
        next: null,
      },
    });
  });
  await page.route(`**/questions/${question.id}/answer`, async (route) => {
    const input = route.request().postDataJSON();
    calls.push({ path: new URL(route.request().url()).pathname, input });
    question.answer = input.body;
    question.answeredBy = owner.id;
    return route.fulfill({ json: question });
  });
  await page.goto(`/chats/${chatId}`);
  const steps = page.getByRole("button", { name: "2 steps", exact: true });
  await expect(steps).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Synthetic report", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({ path: testInfo.outputPath("full-collapsed.png") });
  await steps.focus();
  await page.keyboard.press("Enter");
  await expect(steps).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", {
      name: "document.create · Synthetic report",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Decision by Synthetic Chat sponsor", { exact: false }),
  ).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("full-expanded.png") });
  await page
    .getByRole("button", {
      name: "document.create · Synthetic report",
      exact: true,
    })
    .click();
  await expect(
    page.getByText('"title": "Synthetic report"', { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Decision by Synthetic Chat sponsor", { exact: false }),
  ).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("full-exact-receipt.png"),
  });
  await steps.click();
  await page.reload();
  await expect(steps).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByText("Synthetic UI fixture · no live provider.", {
      exact: false,
    }),
  ).toBeVisible();

  await page.goto("/documents");
  expect(
    (
      await fixture.request(peer.cookie, `/chats/${chatId}/messages`, {
        body: "Synthetic floating Chat check · no live provider.",
        requestId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  await page
    .getByRole("button", { name: /^Chats, .*loaded chats unread/ })
    .click();
  const floating = page.getByRole("dialog", { name: "Chat", exact: true });
  await floating.getByText("Native streaming proof", { exact: true }).click();
  await expect(
    floating.getByRole("button", { name: "2 steps", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({
    path: testInfo.outputPath("floating-collapsed.png"),
  });
  await floating.getByRole("button", { name: "2 steps", exact: true }).click();
  await expect(
    floating.getByRole("button", {
      name: "document.create · Synthetic report",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("floating-expanded.png") });
  await floating
    .getByRole("button", {
      name: "document.create · Synthetic report",
      exact: true,
    })
    .click();
  await expect(
    floating.getByText('"title": "Synthetic report"', { exact: false }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("floating-exact-receipt.png"),
  });
  await expect(
    floating.getByText("NEVER_SHOW_RAW_LOG_OR_REASONING", { exact: false }),
  ).toHaveCount(0);

  includePending = true;
  state = "running";
  outcome = "";
  await page.goto(`/chats/${chatId}`);
  await page.reload();
  await expect(
    page.getByText("Which synthetic report should I use?", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve exact action", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('"title": "Exact pending synthetic action"', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(steps).toHaveAttribute("aria-expanded", "false");
  await page
    .getByLabel("Your answer", { exact: true })
    .fill("Use the first report.");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await expect(
    page.getByText("Use the first report.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve exact action", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "3 steps", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop Run", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This service is unavailable" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("controls-stop-error.png"),
  });
  stopFails = false;
  await page.getByRole("button", { name: "Stop Run", exact: true }).click();
  await expect(
    page.getByText("Stopped or access changed before the work finished.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop Run", exact: true }),
  ).toHaveCount(0);
  state = "failed";
  outcome = "configuration_or_provider_unavailable";
  await page.reload();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "configuration or provider is unavailable" }),
  ).toBeVisible();
  sponsorId = peer.id;
  await page.reload();
  await expect(page.getByRole("button", { name: /\d+ steps?/ })).toHaveCount(0);
  await expect(
    page.getByText("Which synthetic report should I use?", { exact: true }),
  ).toBeVisible();
  sponsorId = owner.id;
  state = "finished";
  outcome = "completed";
  includePending = false;
  const secondAction = approved[1];
  if (!secondAction) throw new Error("Second synthetic action missing");
  secondAction.status = "denied";
  await page.reload();
  await expect(
    page.getByRole("button", { name: "1 step", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByText("Denied. This proposal was not executed.", { exact: true }),
  ).toBeVisible();
  approved.length = 0;
  await page.reload();
  await expect(page.getByRole("button", { name: /\d+ steps?/ })).toHaveCount(0);
  await expect(
    page.getByText(
      /Native usage|private session|Token total|tokens|Cost unknown|completed|NEVER_SHOW_RAW/,
    ),
  ).toHaveCount(0);
  expect(usageRequests).toEqual([]);
  expect(calls.find((call) => call.path.endsWith("/resolve"))?.input).toEqual({
    decision: "approve",
    digest: "synthetic-digest",
  });
  expect(calls.find((call) => call.path.endsWith("/answer"))?.input).toEqual({
    body: "Use the first report.",
  });
  expect(errors).toEqual([]);
  await testInfo.attach("fixture-boundary", {
    body: "Actual app, disposable auth/PostgreSQL and saved human message. Run/activity/action responses and decision acknowledgements are synthetic UI fixtures; no model request or external action was executed.",
    contentType: "text/plain",
  });
});
