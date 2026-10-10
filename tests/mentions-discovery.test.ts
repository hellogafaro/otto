import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgent } from "../packages/agents/src";
import { type ListHarness, startListHarness } from "./fixtures/lists";

type Page = { items: { id?: string; userId?: string }[]; next: string | null };

describe("participant-scoped mention discovery", () => {
  let h: ListHarness;
  beforeAll(async () => {
    h = await startListHarness();
  }, 120000);
  afterAll(async () => {
    await h?.stop();
  });

  const request = (path: string, params: Record<string, string>) =>
    h.api(`${h.base}/${path}?${new URLSearchParams(params)}`);

  it("filters members in SQL before the limit, including empty and sorted continuation", async () => {
    const userIds = JSON.stringify([h.owner.id]);
    const scoped = await request("members", {
      userIds,
      sort: "name",
      limit: "1",
    });
    expect(scoped.status).toBe(200);
    expect(scoped.body).toMatchObject({
      items: [{ userId: h.owner.id }],
      next: null,
    });
    expect((await request("members", { userIds: "[]" })).body).toEqual({
      items: [],
      next: null,
    });
    const both = await request("members", {
      userIds: JSON.stringify([h.owner.id, h.bob.id]),
      sort: "name",
      limit: "1",
    });
    const first = both.body as Page;
    expect(first.items).toEqual([
      { userId: h.bob.id, name: "bob", role: "contributor" },
    ]);
    expect(first.next).toBeTruthy();
    const second = await request("members", {
      userIds: JSON.stringify([h.owner.id, h.bob.id]),
      sort: "name",
      limit: "1",
      after: first.next ?? "",
    });
    expect((second.body as Page).items[0]?.userId).toBe(h.owner.id);
    expect(
      (
        await request("members", {
          userIds,
          sort: "name",
          limit: "1",
          after: first.next ?? "",
        })
      ).status,
    ).toBe(400);
    expect(
      (await request("members", { userIds: '"not an array"' })).status,
    ).toBe(400);
    expect((await request("members", { userIds: "[" })).status).toBe(400);
    expect(
      (
        await request("members", {
          userIds: JSON.stringify(Array(101).fill(h.owner.id)),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.api(
          `${h.base}/members?userIds=${encodeURIComponent(userIds)}`,
          {
            cookie: h.outsider.cookie,
          },
        )
      ).status,
    ).toBe(403);
  });

  it("filters authorized Agents before the limit without revealing private matches", async () => {
    const [first, selected, hidden] = await h.scope(h.owner, async (c) => [
      await createAgent(c, {
        title: "Alpha",
        visibility: "workspace",
        instructions: "test",
        model: "test-model",
      }),
      await createAgent(c, {
        title: "Zed",
        visibility: "workspace",
        instructions: "test",
        model: "test-model",
      }),
      await createAgent(c, {
        title: "Private",
        visibility: "user",
        instructions: "test",
        model: "test-model",
      }),
    ]);
    const scoped = await request("agents", {
      agentIds: JSON.stringify([first.id, selected.id]),
      sort: "title",
      query: "zed",
      limit: "1",
    });
    expect(scoped.status).toBe(200);
    expect((scoped.body as Page).items.map((item) => item.id)).toEqual([
      selected.id,
    ]);
    expect(
      (
        await request("agents", {
          agentIds: JSON.stringify([selected.id]),
          sort: "title",
          limit: "1",
        })
      ).body,
    ).toMatchObject({ items: [{ id: selected.id }], next: null });
    expect((await request("agents", { agentIds: "[]" })).body).toEqual({
      items: [],
      next: null,
    });
    const alice = await h.api(
      `${h.base}/agents?${new URLSearchParams({ agentIds: JSON.stringify([selected.id, hidden.id]) })}`,
      { cookie: h.alice.cookie },
    );
    expect((alice.body as Page).items.map((item) => item.id)).toEqual([
      selected.id,
    ]);
    expect((await request("agents", { agentIds: "not json" })).status).toBe(
      400,
    );
    expect(
      (await request("agents", { agentIds: JSON.stringify(["invalid"]) }))
        .status,
    ).toBe(400);
    expect(
      (
        await request("agents", {
          agentIds: JSON.stringify(Array(101).fill(selected.id)),
        })
      ).status,
    ).toBe(400);
  });
});
