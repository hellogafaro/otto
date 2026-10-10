import { writeFile } from "node:fs/promises";
import { test as base, expect } from "@playwright/test";
import { z } from "zod";
import { startStreamingApp } from "../fixtures/streaming-app";

declare global {
  interface Window {
    streamingSockets: WebSocket[];
    holdDraftClears: boolean;
    heldDraftClears: number;
  }
}

const test = base.extend<{
  fixture: Awaited<ReturnType<typeof startStreamingApp>>;
}>({
  fixture: [
    async ({ playwright: _playwright }, use) => {
      const fixture = await startStreamingApp("http://127.0.0.1:45283");
      const web = Bun.spawn(
        [
          process.execPath,
          "--no-env-file",
          "node_modules/vite/bin/vite.js",
          "--host",
          "127.0.0.1",
          "--port",
          "45283",
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
          .poll(
            async () => (await fetch(fixture.origin).catch(() => null))?.ok,
            { timeout: 15000 },
          )
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
  baseURL: "http://127.0.0.1:45283",
  launchOptions: { executablePath: process.env.OTTO_TEST_CHROMIUM },
});

test("actual native chunks render before completion in full and floating Chat without sharing private drafts", async ({
  page,
  browser,
  fixture,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    window.streamingSockets = [];
    window.holdDraftClears = false;
    window.heldDraftClears = 0;
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener("message", (event) => {
          const frame = JSON.parse(event.data);
          if (
            window.holdDraftClears &&
            frame.type === "drafts" &&
            frame.drafts.length === 0
          ) {
            window.heldDraftClears++;
            event.stopImmediatePropagation();
          }
        });
        window.streamingSockets.push(this);
      }
    };
  });
  const owner = await fixture.register("Streaming sponsor");
  const peer = await fixture.register("Other participant");
  const { workspaceId, chatId, agentIds } = await fixture.setup(
    owner.id,
    peer.id,
  );
  const cookie = (value: string) => ({
    name: value.slice(0, value.indexOf("=")),
    value: value.slice(value.indexOf("=") + 1),
    url: fixture.origin,
  });
  await page.context().addCookies([cookie(owner.cookie)]);
  const peerContext = await browser.newContext({ baseURL: fixture.origin });
  await peerContext.addCookies([cookie(peer.cookie)]);
  const other = await peerContext.newPage();
  try {
    await Promise.all([
      page.goto(`/chats/${chatId}`),
      other.goto(`/chats/${chatId}`),
    ]);
    await expect(
      page.getByRole("button", { name: "Open profile menu", exact: true }),
    ).toBeVisible();
    async function launch(body: string) {
      const response = await fixture.request(owner.cookie, "/runs", {
        chatId,
        agentId: agentIds[0],
        type: "prompt",
        body,
        requestId: crypto.randomUUID(),
      });
      expect(response.status).toBe(200);
      const runId = z.object({ id: z.uuid() }).parse(await response.json()).id;
      await expect
        .poll(() => fixture.controls.has(runId), { timeout: 15000 })
        .toBe(true);
      return runId;
    }
    const runId = await launch("Full Chat");
    await expect(
      page.getByText("Private draft · only you", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Full Chat first", { exact: true }),
    ).toBeInViewport();
    await expect(
      other.getByText("Private draft · only you", { exact: true }),
    ).toHaveCount(0);
    await expect(
      other.getByText("Full Chat first", { exact: true }),
    ).toHaveCount(0);
    expect(
      z
        .object({ state: z.string() })
        .parse(
          await (await fixture.request(owner.cookie, `/runs/${runId}`)).json(),
        ).state,
    ).toBe("running");
    await page.screenshot({
      path: testInfo.outputPath("native-first-chunk-running.png"),
    });
    fixture.controls.get(runId)?.delta(" second chunk");
    await expect(
      page.getByText("Full Chat first second chunk", { exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByText("NEVER_STREAM_REASONING", { exact: false }),
    ).toHaveCount(0);
    expect(
      z
        .object({ state: z.string() })
        .parse(
          await (await fixture.request(owner.cookie, `/runs/${runId}`)).json(),
        ).state,
    ).toBe("running");
    await page.screenshot({
      path: testInfo.outputPath("native-second-chunk-running.png"),
    });
    await page.evaluate(() =>
      window.streamingSockets.forEach((socket) => {
        socket.close();
      }),
    );
    await expect(
      page.getByText("Private draft · only you", { exact: true }),
    ).toHaveCount(0, { timeout: 900 });
    await expect(
      page.getByText("Full Chat first second chunk", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      window.holdDraftClears = true;
    });
    fixture.controls.get(runId)?.finish();
    await expect(
      other.getByText("Full Chat first second chunk", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Full Chat first second chunk", { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByText("Private draft · only you", { exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => window.heldDraftClears)).toBeGreaterThan(
      0,
    );
    await page.evaluate(() => {
      window.holdDraftClears = false;
    });
    await page.reload();
    await expect(
      page.getByText("Full Chat first second chunk", { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByText("Private draft · only you", { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("native-published-reload.png"),
    });

    await page.goto("/documents");
    expect(
      (
        await fixture.request(peer.cookie, `/chats/${chatId}/messages`, {
          body: "Open the shared chat",
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(200);
    const floatingRun = await launch("Floating Chat");
    await page
      .getByRole("button", { name: /^Chats, .*loaded chats unread/ })
      .click();
    await page
      .getByRole("dialog", { name: "Chat", exact: true })
      .getByText("Native streaming proof", { exact: true })
      .click();
    const floating = page.getByRole("dialog", { name: "Chat", exact: true });
    await expect(
      floating.getByText("Private draft · only you", { exact: true }),
    ).toBeVisible();
    await expect(
      floating.getByText("Floating Chat first", { exact: true }),
    ).toBeInViewport();
    fixture.controls.get(floatingRun)?.delta(" next chunk");
    await expect(
      floating.getByText("Floating Chat first next chunk", { exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("native-floating-incremental.png"),
    });
    await floating
      .getByRole("button", { name: "Stop Run", exact: true })
      .click();
    await expect(
      floating.getByText("Private draft · only you", { exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          z
            .object({ state: z.string() })
            .parse(
              await (
                await fixture.request(owner.cookie, `/runs/${floatingRun}`)
              ).json(),
            ).state,
      )
      .toBe("interrupted");
    const saved = z
      .array(z.object({ body: z.string() }))
      .parse(
        await (
          await fixture.request(owner.cookie, `/chats/${chatId}/messages`)
        ).json(),
      );
    expect(saved.map((message) => message.body)).not.toContain(
      "Floating Chat first next chunk",
    );
    expect(errors).toEqual([]);
    const outcome = JSON.stringify(
      {
        workspaceId,
        runId,
        floatingRun,
        actualIncrementalChunks: true,
        sponsorOnly: true,
        disconnectCleared: true,
        reconnectRecovered: true,
        reloadSinglePublication: true,
        floatingStopCleared: true,
        browserErrors: errors,
      },
      null,
      2,
    );
    await writeFile(testInfo.outputPath("source-outcome.json"), outcome);
    await testInfo.attach("source-outcome", {
      body: outcome,
      contentType: "application/json",
    });
  } finally {
    await peerContext.close();
  }
});
