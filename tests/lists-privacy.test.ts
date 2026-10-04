import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ListHarness, startListHarness, uuid } from "./fixtures/lists";

type Signature = { titles: string[]; hasNext: boolean; cursorLength: number }[];

/** Sorted-list oracle: what a reader sees must not depend on rows they cannot read. */
describe("a hidden row leaves no trace in sorted pages or cursors", () => {
  let h: ListHarness;
  beforeAll(async () => {
    h = await startListHarness();
  }, 120000);
  afterAll(async () => {
    await h?.stop();
  });
  const walkSignature = async (params: Record<string, string | number>) => {
    const walked = await h.walk(
      `${h.base}/documents`,
      { sort: "title", limit: 1, ...params },
      h.bob.cookie,
    );
    return walked.pages.map((page) => ({
      titles: page.items.map((item) => String(item.title)),
      hasNext: page.next !== null,
      cursorLength: typeof page.next === "string" ? page.next.length : 0,
    })) satisfies Signature;
  };

  it("shows the reader the same pages, empty-page pattern and cursors with and without hidden rows", async () => {
    const hidden = await h.project("Hidden", false);
    const visible = ["alpha", "charlie", "echo", "golf"];
    for (const title of visible)
      await h.api(`${h.base}/documents`, {
        cookie: h.bob.cookie,
        method: "POST",
        json: { title: `zzorc ${title}`, body: "p", visibility: "workspace" },
      });
    const baseline = await walkSignature({ query: "zzorc" });
    // Hidden rows of very different lengths, placed between and after every visible probe.
    const lengths = [3, 10, 60, 200];
    for (const [i, title] of ["bravo", "delta", "foxtrot", "hotel"].entries())
      await h.database.pool.query(
        `insert into documents (id,"workspaceId",title,body,"createdBy",visibility,"projectId")
         values ($1,$2,$3,'b',$4,'workspace',$5)`,
        [
          uuid(i + 1, "00000000-0000-4000-8200"),
          h.workspaceId,
          `zzorc ${title}${"x".repeat((lengths[i] ?? 3) - 3)}`,
          h.owner.id,
          hidden,
        ],
      );
    const withHidden = await walkSignature({ query: "zzorc" });
    // The reader still cannot read a hidden row directly.
    expect(
      (
        await h.api(
          `${h.base}/documents/${uuid(1, "00000000-0000-4000-8200")}`,
          { cookie: h.bob.cookie },
        )
      ).status,
    ).toBe(403);
    // No empty page, same visible items and order, same cursor presence and length per page.
    expect(withHidden.filter((page) => page.titles.length === 0)).toEqual([]);
    expect(withHidden).toEqual(baseline);
    // Descending order and a larger page keep the same property.
    for (const params of [{ order: "desc" }, { limit: 2 }] as Record<
      string,
      string | number
    >[]) {
      const without = await h.database.pool.query(
        `select count(*)::int as n from documents where "projectId"=$1`,
        [hidden],
      );
      expect(without.rows[0].n).toBe(4);
      const seen = await walkSignature({ query: "zzorc", ...params });
      expect(seen.filter((page) => page.titles.length === 0)).toEqual([]);
    }
  });
});
