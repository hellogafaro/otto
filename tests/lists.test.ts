import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFolder } from "../packages/library/src";
import { members, workspaces } from "../packages/workspaces/src/schema";
import {
  type Human,
  type ListHarness,
  startListHarness,
  uuid,
} from "./fixtures/lists";

/** Sorted `next` tokens never expose a scanned row's value: no readable and no trivially encoded copy of it. */
function leaks(text: string, secrets: string[]) {
  const forms = (value: string) => [
    value,
    value.toLowerCase(),
    Buffer.from(value).toString("base64"),
    Buffer.from(value).toString("base64url"),
    Buffer.from(value).toString("hex"),
  ];
  const decoded: string[] = [];
  for (const match of text.matchAll(/"next":"([^"]+)"/g)) {
    const token = match[1] ?? "";
    decoded.push(
      Buffer.from(token, "base64url").toString("latin1"),
      Buffer.from(token, "base64").toString("latin1"),
    );
  }
  return secrets.some((secret) =>
    [text, ...decoded].some((haystack) =>
      forms(secret).some((form) => haystack.includes(form)),
    ),
  );
}

describe("sorted and filtered discovery: Documents, cursors and privacy over HTTP and private PostgreSQL", () => {
  let h: ListHarness;
  let alice: Human;
  const docs = (
    rows: {
      n: number;
      prefix: string;
      title: string;
      projectId?: string | null;
      updatedAt?: string | null;
      createdBy?: string;
      visibility?: "user" | "workspace";
    }[],
  ) =>
    Promise.all(
      rows.map((row) =>
        h.database.pool.query(
          `insert into documents (id,"workspaceId",title,body,"createdBy",visibility,"projectId","createdAt","updatedAt")
           values ($1,$2,$3,'body',$4,$5,$6,$7::timestamptz,$8::timestamptz)`,
          [
            uuid(row.n, row.prefix),
            h.workspaceId,
            row.title,
            row.createdBy ?? h.owner.id,
            row.visibility ?? "workspace",
            row.projectId ?? null,
            row.updatedAt === undefined
              ? "2026-01-01T00:00:00Z"
              : row.updatedAt,
            row.updatedAt === undefined
              ? "2026-01-01T00:00:00Z"
              : row.updatedAt,
          ],
        ),
      ),
    );
  const list = (query: string, cookie?: string) =>
    h.api(`${h.base}/documents?${query}`, { cookie });
  const ids = (prefix: string, order: number[]) =>
    order.map((n) => uuid(n, prefix));
  beforeAll(async () => {
    h = await startListHarness();
    alice = h.alice;
  }, 120000);
  afterAll(async () => {
    await h?.stop();
  });

  it("orders the whole candidate set before the limit, with the plain id order and 100 limit unchanged", async () => {
    const projectId = await h.project("Volume");
    await h.database.pool.query(
      `insert into documents (id,"workspaceId",title,body,"createdBy",visibility,"projectId","createdAt","updatedAt")
       select ('00000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid, $1, 'Vol '||i, 'b', $2, 'workspace', $3,
         timestamptz '2026-01-01T00:00:00Z' + i * interval '1 minute', timestamptz '2026-01-01T00:00:00Z' + i * interval '1 minute'
       from generate_series(1,130) i`,
      [h.workspaceId, h.owner.id, projectId],
    );
    const prefix = "00000000-0000-4000-8001";
    const q = `projectId=${projectId}`;
    // Without sort: id ascending, plain UUID cursor, default and maximum 100.
    const plain = await list(q);
    expect(plain.status).toBe(200);
    const first = plain.body as { items: { id: string }[]; next: string };
    expect(first.items.map((item) => item.id)).toEqual(
      ids(
        prefix,
        Array.from({ length: 100 }, (_, i) => i + 1),
      ),
    );
    expect(first.next).toBe(uuid(100, prefix));
    expect((await list(`${q}&after=${first.next}`)).body).toMatchObject({
      next: null,
    });
    expect((await list(`${q}&limit=101`)).status).toBe(400);
    expect((await list(`${q}&limit=0`)).status).toBe(400);
    expect(
      ((await list(`${q}&limit=1`)).body as { items: unknown[] }).items,
    ).toHaveLength(1);
    // The newest row has the highest id, so an id-ordered scan never reaches it in the first 100.
    const newest = await list(`${q}&sort=updatedAt&order=desc&limit=5`);
    expect(
      (newest.body as { items: { id: string }[] }).items.map((i) => i.id),
    ).toEqual(ids(prefix, [130, 129, 128, 127, 126]));
    const oldest = await list(`${q}&sort=updatedAt&limit=5`);
    expect(
      (oldest.body as { items: { id: string }[] }).items.map((i) => i.id),
    ).toEqual(ids(prefix, [1, 2, 3, 4, 5]));
    const every = Array.from({ length: 130 }, (_, i) => i + 1);
    for (const [order, expected] of [
      ["asc", every],
      ["desc", [...every].reverse()],
    ] as const)
      for (const limit of [7, 100]) {
        const walked = await h.walk(`${h.base}/documents`, {
          projectId,
          sort: "updatedAt",
          order,
          limit,
        });
        expect(walked.ids).toEqual(ids(prefix, expected));
      }
    // The sorted continuation is opaque and never a bare UUID.
    const sorted = (await list(`${q}&sort=updatedAt&limit=2`)).body as {
      next: string;
    };
    expect(sorted.next).not.toMatch(/^[0-9a-f]{8}-/);
  });

  it("keeps microsecond ties, NULLs last in both directions and a stable id tie-break across pages", async () => {
    const projectId = await h.project("Ties");
    const prefix = "00000000-0000-4000-8002";
    const at = (micro: string | null) =>
      micro === null ? null : `2026-03-01T00:00:00.${micro}Z`;
    const stamps = [
      "000002",
      "000001",
      "000002",
      null,
      "000001",
      "001000",
      null,
      "000002",
    ];
    await docs(
      stamps.map((micro, i) => ({
        n: i + 1,
        prefix,
        title: `Tie ${i + 1}`,
        projectId,
        updatedAt: at(micro),
      })),
    );
    // asc: 1us (d2,d5), 2us (d1,d3,d8), 1ms (d6), then NULLs (d4,d7).
    const asc = [2, 5, 1, 3, 8, 6, 4, 7];
    // desc: 1ms (d6), 2us by id desc (d8,d3,d1), 1us (d5,d2), then NULLs by id desc (d7,d4).
    const desc = [6, 8, 3, 1, 5, 2, 7, 4];
    for (const limit of [1, 3, 8])
      for (const [order, expected] of [
        ["asc", asc],
        ["desc", desc],
      ] as const) {
        const walked = await h.walk(`${h.base}/documents`, {
          projectId,
          sort: "updatedAt",
          order,
          limit,
        });
        expect(walked.ids).toEqual(ids(prefix, expected));
      }
  });

  it("sorts titles case-insensitively over their full value, even when the first 100 characters coincide", async () => {
    const projectId = await h.project("Titles");
    const prefix = "00000000-0000-4000-8003";
    const long = "x".repeat(150);
    const titles = [
      "Apple",
      "banana",
      "cherry",
      "apple",
      "Banana",
      `${long}b`,
      `${long}a`,
    ];
    await docs(
      titles.map((title, i) => ({ n: i + 1, prefix, title, projectId })),
    );
    // Equal lowercase titles tie by id in the same direction as the order.
    const asc = [1, 4, 2, 5, 3, 7, 6];
    const desc = [6, 7, 3, 5, 2, 4, 1];
    for (const limit of [1, 2, 100])
      for (const [order, expected] of [
        ["asc", asc],
        ["desc", desc],
      ] as const)
        expect(
          (
            await h.walk(`${h.base}/documents`, {
              projectId,
              sort: "title",
              order,
              limit,
            })
          ).ids,
        ).toEqual(ids(prefix, expected));
  });

  it("continues after the cursor row and others were deleted without skipping later rows", async () => {
    const projectId = await h.project("Deleted");
    const prefix = "00000000-0000-4000-8004";
    await docs(
      Array.from({ length: 10 }, (_, i) => ({
        n: i + 1,
        prefix,
        title: `d${String(i + 1).padStart(2, "0")}`,
        projectId,
      })),
    );
    const page = (await list(`projectId=${projectId}&sort=title&limit=3`))
      .body as { items: { id: string }[]; next: string };
    expect(page.items.map((i) => i.id)).toEqual(ids(prefix, [1, 2, 3]));
    await h.database.pool.query(`delete from documents where id = any($1)`, [
      ids(prefix, [3, 4]),
    ]);
    const rest = await h.walk(`${h.base}/documents`, {
      projectId,
      sort: "title",
      limit: 3,
      after: page.next,
    });
    expect(rest.ids).toEqual(ids(prefix, [5, 6, 7, 8, 9, 10]));
  });

  it("refuses unknown keys, injected sorts, order without sort and out-of-range limits on every list", async () => {
    const missing = uuid(404);
    const lists: [string, string][] = [
      ["/workspaces", "title"],
      [`${h.base}/members`, "name"],
      [`${h.base}/projects`, "title"],
      [`${h.base}/projects/${missing}/members`, "name"],
      [`${h.base}/tasks?projectId=${missing}`, "title"],
      [`${h.base}/tasks/${missing}/links`, "type"],
      [`${h.base}/timesheets?taskId=${missing}`, "createdAt"],
      [`${h.base}/chats`, "title"],
      [`${h.base}/chats/${missing}/participants`, "role"],
      [`${h.base}/chats/${missing}/sessions`, "createdAt"],
      [`${h.base}/agents`, "title"],
      [`${h.base}/documents`, "title"],
      [`${h.base}/collections`, "title"],
      [`${h.base}/documents/${missing}/proposals`, "title"],
      [`${h.base}/files`, "title"],
      [`${h.base}/folders`, "title"],
      [`${h.base}/library`, "title"],
      [`${h.base}/shares`, ""],
      [`${h.base}/skills`, "title"],
      [`${h.base}/skills/${missing}/proposals`, "title"],
      [`${h.base}/connections`, "title"],
      [`${h.base}/connections/${missing}/operations`, "createdAt"],
      [`${h.base}/subscriptions`, "title"],
      [`${h.base}/schedules`, "title"],
      [`${h.base}/schedules/${missing}/history`, "receivedAt"],
      [`${h.base}/runs`, "createdAt"],
      [`${h.base}/chats/${missing}/messages`, ""],
      [`${h.base}/runs/${missing}/activity`, ""],
      [`${h.base}/attention`, ""],
    ];
    const join = (path: string, query: string) =>
      `${path}${path.includes("?") ? "&" : "?"}${query}`;
    for (const [path, sort] of lists) {
      const bad = [
        "bogus=1",
        "after=&limit=1",
        sort ? "order=asc" : "order=asc&sort=x",
        "sort=nope",
        'sort=title";drop table documents;--',
        "sort=id",
        "sort=updatedAt%20desc",
        "limit=101",
        "limit=0",
        "limit=1.5",
        "limit=abc",
        sort ? `sort=${sort}&order=sideways` : "sort=updatedAt",
        sort ? `sort=${sort}&order=ASC` : "sort=title",
      ];
      for (const query of bad) {
        const response = await h.api(join(path, query));
        expect(
          response.status,
          `GET ${join(path, query)} -> ${response.text}`,
        ).toBe(400);
      }
    }
    // Messages, activity and the attention composition keep their own cursors and reject sorting.
    for (const path of [
      `${h.base}/chats/${missing}/messages`,
      `${h.base}/runs/${missing}/activity`,
      `${h.base}/attention`,
    ])
      expect((await h.api(join(path, "sort=title"))).status).toBe(400);
  });

  it("never returns or encodes a scanned but unreadable row's value, and rejects reused or tampered cursors", async () => {
    const hidden = await h.project("Hidden", false);
    const prefix = "00000000-0000-4000-8005";
    // Hidden rows are workspace-visible but live in a Project alice does not belong to, so a scan still reaches them.
    await docs([
      { n: 1, prefix, title: "zzpriv alpha", visibility: "workspace" },
      {
        n: 2,
        prefix,
        title: "zzpriv bravo SECRETONE",
        projectId: hidden,
        visibility: "workspace",
      },
      {
        n: 3,
        prefix,
        title: "zzpriv charlie SECRETTWO",
        projectId: hidden,
        visibility: "workspace",
      },
      { n: 4, prefix, title: "zzpriv delta", visibility: "workspace" },
    ]);
    const filter = "query=zzpriv&sort=title";
    const owner = await h.walk(`${h.base}/documents`, {
      query: "zzpriv",
      sort: "title",
    });
    expect(owner.ids).toEqual(ids(prefix, [1, 2, 3, 4]));
    const walked = await h.walk(
      `${h.base}/documents`,
      { query: "zzpriv", sort: "title", limit: 1 },
      alice.cookie,
    );
    expect(walked.ids).toEqual(ids(prefix, [1, 4]));
    // Hidden rows are narrowed in SQL, so the reader's walk has no empty page and no trace of them.
    expect(walked.pages.map((p) => p.items.length)).toEqual([1, 1]);
    expect(walked.pages.map((p) => p.next !== null)).toEqual([true, false]);
    expect(
      leaks(walked.bodies.join("\n"), [
        "SECRETONE",
        "SECRETTWO",
        "bravo",
        "charlie",
        "zzpriv bravo",
      ]),
    ).toBe(false);
    for (const body of walked.bodies) expect(body).not.toMatch(/SECRET/i);
    const cursors = walked.pages
      .map((p) => p.next)
      .filter((next): next is string => typeof next === "string");
    const cursor = cursors[0] ?? "";
    expect(cursor.length).toBeGreaterThan(40);
    // The same request continues; every change of identity, workspace, operation, filter or sort is a clean 400.
    expect(
      (await list(`${filter}&limit=1&after=${cursor}`, alice.cookie)).status,
    ).toBe(200);
    const rejected = [
      await list(`${filter}&limit=1&after=${cursor}`, h.bob.cookie),
      await list(
        `query=zzpriv%20alpha&sort=title&after=${cursor}`,
        alice.cookie,
      ),
      await list(
        `query=zzpriv&sort=title&archived=true&after=${cursor}`,
        alice.cookie,
      ),
      await list(
        `query=zzpriv&sort=title&order=desc&after=${cursor}`,
        alice.cookie,
      ),
      await list(`query=zzpriv&sort=createdAt&after=${cursor}`, alice.cookie),
      await list(`query=zzpriv&after=${cursor}`, alice.cookie),
      await h.api(`${h.base}/files?query=zzpriv&sort=title&after=${cursor}`, {
        cookie: alice.cookie,
      }),
      await h.api(
        `${h.base}/collections?query=zzpriv&sort=title&after=${cursor}`,
        { cookie: alice.cookie },
      ),
      await list(
        `${filter}&after=${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`,
        alice.cookie,
      ),
      await list(`${filter}&after=${cursor.slice(0, 30)}`, alice.cookie),
      await list(`${filter}&after=${"A".repeat(60)}`, alice.cookie),
      await list(`${filter}&after=${"A".repeat(5000)}`, alice.cookie),
      await list(`${filter}&after=${uuid(1, prefix)}`, alice.cookie),
    ];
    for (const response of rejected) expect(response.status).toBe(400);
    // Another Workspace is another scope even for the same person.
    const other = crypto.randomUUID();
    await h.database.db
      .insert(workspaces)
      .values({ id: other, title: "Other" });
    await h.database.db
      .insert(members)
      .values({ workspaceId: other, userId: alice.id, role: "contributor" });
    expect(
      (
        await h.api(
          `/workspaces/${other}/documents?${filter}&after=${cursor}`,
          {
            cookie: alice.cookie,
          },
        )
      ).status,
    ).toBe(400);
    // A changed page size is still the same request.
    expect(
      (await list(`${filter}&limit=2&after=${cursor}`, alice.cookie)).status,
    ).toBe(200);
  });

  it("keeps cursors valid across a restart with the same secret and ends them cleanly on rotation", async () => {
    const projectId = await h.project("Restart");
    const prefix = "00000000-0000-4000-8006";
    await docs(
      Array.from({ length: 6 }, (_, i) => ({
        n: i + 1,
        prefix,
        title: `r${i + 1}`,
        projectId,
      })),
    );
    const path = `${h.base}/documents`;
    const query = `projectId=${projectId}&sort=title&limit=2`;
    const first = (await h.api(`${path}?${query}`)).body as {
      next: string;
      items: { id: string }[];
    };
    const same = await h.instance(h.secret)(
      `${path}?${query}&after=${first.next}`,
      h.owner.cookie,
    );
    expect(same.status).toBe(200);
    expect(
      ((await same.json()) as { items: { id: string }[] }).items.map(
        (i) => i.id,
      ),
    ).toEqual(ids(prefix, [3, 4]));
    const rotated = await h.instance(`${h.secret}-rotated-key`)(
      `${path}?${query}&after=${first.next}`,
      h.owner.cookie,
    );
    expect(rotated.status).toBe(400);
    // Without a configured secret a sorted list is unavailable, never silently keyed; id order still works.
    const bare = h.instance();
    expect((await bare(`${path}?${query}`, h.owner.cookie)).status).toBe(503);
    expect(
      (await bare(`${path}?projectId=${projectId}&limit=2`, h.owner.cookie))
        .status,
    ).toBe(200);
  });

  it("fits the widest supported titles in a cursor, including through the library prefix", async () => {
    const projectId = await h.project("Wide");
    const prefix = "00000000-0000-4000-8007";
    const wide = ["字".repeat(200), "😀".repeat(100), "\u0001".repeat(200)];
    await docs(
      wide.map((title, i) => ({ n: i + 1, prefix, title, projectId })),
    );
    const walked = await h.walk(`${h.base}/documents`, {
      projectId,
      sort: "title",
      limit: 1,
    });
    expect(walked.ids).toHaveLength(3);
    const lengths = walked.pages
      .map((page) => (typeof page.next === "string" ? page.next.length : 0))
      .filter(Boolean);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(4096);
    const library = await h.walk(`${h.base}/library`, {
      projectId,
      sort: "title",
      limit: 1,
    });
    expect(library.items.map((item) => item.id).sort()).toEqual(
      ids(prefix, [1, 2, 3]).sort(),
    );
    const prefixed = library.pages
      .map((page) => (typeof page.next === "string" ? page.next : ""))
      .filter(Boolean);
    expect(prefixed.every((next) => next.startsWith("document:"))).toBe(true);
    expect(
      Math.max(...prefixed.map((next) => next.length)),
    ).toBeLessThanOrEqual(4096 + "document:".length);
    console.info(
      `max sealed cursor length ${Math.max(...lengths)}; max library cursor ${Math.max(...prefixed.map((n) => n.length))}`,
    );
  });

  it("refuses, rather than truncates, a sort value that cannot fit a cursor", async () => {
    const projectId = await h.project("Oversize");
    const prefix = "00000000-0000-4000-8008";
    await docs([
      { n: 1, prefix, title: "\u0001".repeat(3000), projectId },
      { n: 2, prefix, title: "\u0001".repeat(3000), projectId },
    ]);
    const response = await list(`projectId=${projectId}&sort=title&limit=1`);
    expect(response.status).toBe(503);
    // Plain id order, which carries no sort value, is unaffected.
    expect((await list(`projectId=${projectId}&limit=1`)).status).toBe(200);
  });

  it("keeps a 100-row page at a bounded number of statements, unchanged by sorting", async () => {
    const projectId = await h.project("Statements");
    await h.database.pool.query(
      `insert into documents (id,"workspaceId",title,body,"createdBy",visibility,"projectId")
       select gen_random_uuid(), $1, 'S '||i, 'b', $2, 'workspace', $3 from generate_series(1,150) i`,
      [h.workspaceId, h.owner.id, projectId],
    );
    const statements = (query: string) =>
      h.countStatements(async () => {
        const response = await list(`projectId=${projectId}&${query}`);
        expect(response.status).toBe(200);
      });
    const plain = await statements("limit=100");
    const sorted = await statements("sort=updatedAt&order=desc&limit=100");
    const small = await statements("sort=updatedAt&order=desc&limit=5");
    // The existing per-row authority check (about four statements a row) is the whole cost: one candidate
    // query of limit+1 rows, never a scan of the table, and the same cost with or without a sort.
    expect(sorted).toBe(plain);
    expect(plain).toBeLessThanOrEqual(100 * 4 + 20);
    expect(small).toBeLessThanOrEqual(5 * 4 + 20);
    console.info(
      `statements: 100-row page ${plain} (sorted ${sorted}), 5-row page ${small}`,
    );
  });

  it("proves the folder the library lists first is a Folder grouping, not a global order", async () => {
    const projectId = await h.project("Library");
    await h.scope(h.owner, (c) =>
      createFolder(c, {
        title: "zzz folder",
        projectId,
        visibility: "workspace",
      }),
    );
    await docs([
      { n: 1, prefix: "00000000-0000-4000-8009", title: "aaa doc", projectId },
    ]);
    const library = await h.walk(`${h.base}/library`, {
      projectId,
      sort: "title",
    });
    expect(library.items.map((item) => item.type)).toEqual([
      "folder",
      "document",
    ]);
  });
});
