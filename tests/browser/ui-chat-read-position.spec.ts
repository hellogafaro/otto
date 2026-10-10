import { register } from "./account";
import { expect, test } from "./live-app";

test("read acknowledgements update attention without refetching the workspace directory", async ({
  page,
  fixture,
}) => {
  const { workspaceId } = await register(page, fixture, "Read Position Owner");
  const base = `${fixture.origin}/api/workspaces/${workspaceId}`;
  const created = await page.request.post(`${base}/chats`, {
    headers: { origin: fixture.origin },
    data: { title: "Read position proof", visibility: "participants" },
  });
  expect(created.status()).toBe(200);
  const chat = (await created.json()) as { id: string };
  for (let index = 0; index < 4; index++) {
    const response = await page.request.post(
      `${base}/chats/${chat.id}/messages`,
      {
        headers: { origin: fixture.origin },
        data: {
          body: `Read position message ${index}`,
          requestId: crypto.randomUUID(),
        },
      },
    );
    expect(response.status()).toBe(200);
  }
  const attentionBefore = await page.request.get(`${base}/attention`);
  expect(attentionBefore.status()).toBe(200);
  expect(await attentionBefore.text()).toContain("Read position message 3");

  const release = Promise.withResolvers<void>();
  let held = 0;
  let acknowledged = 0;
  await page.route(`**/chats/${chat.id}/read`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    held++;
    await release.promise;
    await route.fulfill({ response });
    acknowledged++;
  });
  const directory = new Map<string, number>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      ["agents", "members", "projects"].some(
        (resource) =>
          url.pathname === `/api/workspaces/${workspaceId}/${resource}`,
      )
    )
      directory.set(url.pathname, (directory.get(url.pathname) ?? 0) + 1);
  });
  try {
    await page.goto(`/chats/${chat.id}`);
    await expect(
      page.getByText("Read position message 3", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => held).toBe(4);
    const initial = [...directory];
    expect(initial).toHaveLength(3);
    release.resolve();
    await expect.poll(() => acknowledged).toBe(4);
    await page.waitForTimeout(500);
    expect([...directory]).toEqual(initial);
    await expect(
      page.getByText("Retry saving read position", { exact: true }),
    ).toHaveCount(0);
    const attentionAfter = await page.request.get(`${base}/attention`);
    expect(attentionAfter.status()).toBe(200);
    expect(await attentionAfter.text()).not.toContain(
      "Read position message 3",
    );
  } finally {
    release.resolve();
    await page.unroute(`**/chats/${chat.id}/read`);
  }
});
