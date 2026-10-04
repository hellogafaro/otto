import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { createFolder } from "../packages/files/src";
import {
  claimInstallation,
  getCursor,
  inWorkspace,
} from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import { fixtureStorage, testSpool } from "./fixtures/storage";
import { startPostgres } from "./postgres";

type Human = { id: string; cookie: string };
describe("folders, placement rules and the mixed library through real HTTP and private PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: Awaited<ReturnType<typeof startQueue>>;
  let server: ReturnType<typeof Bun.serve>;
  let transfers: Awaited<ReturnType<typeof testSpool>>;
  let app: ReturnType<typeof createApp>;
  let origin: string;
  let workspaceId: string;
  let owner: Human;
  let peer: Human;
  let viewer: Human;
  let projectId: string;
  let human: (label: string) => Promise<Human>;
  const objects = new Map<string, Uint8Array>();
  const get = async (key: string) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("missing");
    return bytes;
  };
  beforeAll(async () => {
    database = await startPostgres();
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    transfers = await testSpool();
    const secret = crypto.randomUUID() + crypto.randomUUID();
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (r) => app.fetch(r),
    });
    origin = server.url.origin;
    const auth = createAuth(database.db, secret, origin);
    app = createApp({
      db: database.db,
      auth,
      boss,
      origin,
      storage: fixtureStorage({
        async put(key, bytes) {
          objects.set(key, bytes.slice());
        },
        get,
      }),
      spool: transfers.spool,
    });
    human = async (label: string): Promise<Human> => {
      const response = await auth.api.signUpEmail({
        body: {
          name: label,
          email: `${label}@example.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        },
        asResponse: true,
      });
      const cookie = response.headers.get("set-cookie") ?? "";
      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      if (!session) throw new Error("session");
      return { id: session.user.id, cookie };
    };
    owner = await human("owner");
    peer = await human("peer");
    viewer = await human("viewer");
    workspaceId = (await claimInstallation(database.db, owner.id, "Folders"))
      .id;
    await database.db.insert(members).values([
      { workspaceId, userId: peer.id, role: "contributor" },
      { workspaceId, userId: viewer.id, role: "viewer" },
    ]);
    projectId = (await call(owner, "/projects", "POST", { title: "P" })).id;
  }, 60000);
  afterAll(async () => {
    await server?.stop(true);
    await boss?.stop();
    await transfers?.close();
    await database?.stop();
  });
  const raw = (who: Human, path: string, method = "GET", body?: unknown) =>
    fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
      method,
      headers: {
        cookie: who.cookie,
        origin,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const call = async (
    who: Human,
    path: string,
    method = "GET",
    body?: unknown,
  ) => {
    const response = await raw(who, path, method, body);
    const text = await response.text();
    expect(response.status, `${method} ${path}: ${text}`).toBe(200);
    return JSON.parse(text);
  };
  const status = async (
    who: Human,
    path: string,
    method: string,
    body?: unknown,
  ) => (await raw(who, path, method, body)).status;
  const folder = (
    who: Human,
    title: string,
    extra: Record<string, unknown> = {},
  ) =>
    call(who, "/folders", "POST", { title, visibility: "workspace", ...extra });
  const file = (
    who: Human,
    title: string,
    extra: Record<string, unknown> = {},
  ) =>
    call(who, "/files", "POST", {
      requestId: crypto.randomUUID(),
      title,
      type: "note",
      mediaType: "text/plain",
      visibility: "workspace",
      bytes: Buffer.from(title).toString("base64"),
      ...extra,
    });
  const doc = (
    who: Human,
    title: string,
    extra: Record<string, unknown> = {},
  ) =>
    call(who, "/documents", "POST", {
      title,
      body: "body",
      visibility: "workspace",
      ...extra,
    });
  const cursor = () =>
    inWorkspace(
      database.db,
      workspaceId,
      { userId: owner.id },
      getCursor,
      false,
    );

  it("creates nested folders, lists children and returns a breadcrumb without unreadable ancestors", async () => {
    const a = await folder(owner, "A");
    const b = await folder(owner, "B", { parentId: a.id });
    const c = await folder(owner, "C", { parentId: b.id });
    expect(c).toMatchObject({
      parentId: b.id,
      createdBy: owner.id,
      archived: false,
    });
    const read = await call(peer, `/folders/${c.id}`);
    expect(read.path.map((p: { title: string }) => p.title)).toEqual([
      "A",
      "B",
      "C",
    ]);
    const roots = await call(peer, "/folders?root=true");
    expect(roots.items.map((f: { id: string }) => f.id)).toContain(a.id);
    expect(roots.items.map((f: { id: string }) => f.id)).not.toContain(b.id);
    const children = await call(peer, `/folders?parentId=${a.id}`);
    expect(children.items.map((f: { id: string }) => f.id)).toEqual([b.id]);
    expect(
      await status(viewer, "/folders", "POST", {
        title: "no",
        visibility: "workspace",
      }),
    ).toBe(403);
    expect(
      await status(owner, "/folders", "POST", {
        title: "x",
        visibility: "workspace",
        surprise: 1,
      }),
    ).toBe(400);
  });

  it("bounds nesting depth and refuses cycles, including a concurrent crossing move", async () => {
    let parent: string | undefined;
    const chain: string[] = [];
    for (let depth = 1; depth <= 8; depth++) {
      const created = await folder(owner, `D${depth}`, { parentId: parent });
      chain.push(created.id);
      parent = created.id;
    }
    expect(
      await status(owner, "/folders", "POST", {
        title: "D9",
        visibility: "workspace",
        parentId: parent,
      }),
    ).toBe(409);
    const top = chain[0] as string;
    const leaf = chain[7] as string;
    expect(
      await status(owner, `/folders/${top}`, "PATCH", { parentId: top }),
    ).toBe(409);
    expect(
      await status(owner, `/folders/${top}`, "PATCH", { parentId: leaf }),
    ).toBe(409);
    const standalone = await folder(owner, "Solo");
    // Moving a subtree under the leaf would exceed the maximum depth.
    expect(
      await status(owner, `/folders/${standalone.id}`, "PATCH", {
        parentId: leaf,
      }),
    ).toBe(409);
    const x = await folder(owner, "X");
    const y = await folder(owner, "Y");
    const results = await Promise.all([
      status(owner, `/folders/${x.id}`, "PATCH", { parentId: y.id }),
      status(owner, `/folders/${y.id}`, "PATCH", { parentId: x.id }),
    ]);
    expect(results.sort()).toEqual([200, 409]);
    const [fx, fy] = await Promise.all([
      call(owner, `/folders/${x.id}`),
      call(owner, `/folders/${y.id}`),
    ]);
    expect(fx.parentId === y.id && fy.parentId === x.id).toBe(false);
  });

  it("moves Files and Documents without touching bytes, keys, requests or snapshots, and first placement wins", async () => {
    const target = await folder(owner, "Target");
    const other = await folder(owner, "Other");
    const requestId = crypto.randomUUID();
    const created = await file(owner, "Report", {
      requestId,
      folderId: target.id,
    });
    expect(created.folderId).toBe(target.id);
    const before = (
      await database.pool.query(
        'select "objectKey",sha256,"byteLength",request::text,"sourceRunId" from files where id=$1',
        [created.id],
      )
    ).rows[0];
    const moved = await call(owner, `/files/${created.id}`, "PATCH", {
      folderId: other.id,
    });
    expect(moved.folderId).toBe(other.id);
    // An exact retry never moves the File back or resets later organization.
    const retried = await file(owner, "Report", {
      requestId,
      folderId: target.id,
    });
    expect(retried.id).toBe(created.id);
    expect(retried.folderId).toBe(other.id);
    const after = (
      await database.pool.query(
        'select "objectKey",sha256,"byteLength",request::text,"sourceRunId" from files where id=$1',
        [created.id],
      )
    ).rows[0];
    expect(after).toEqual(before);
    expect(
      (await call(owner, `/files/${created.id}`, "PATCH", { folderId: null }))
        .folderId,
    ).toBeNull();
    const document = await doc(owner, "Spec");
    const filed = await call(owner, `/documents/${document.id}`, "PATCH", {
      folderId: target.id,
      title: "Spec v2",
      editToken: document.editToken,
    });
    expect(filed).toMatchObject({ folderId: target.id, title: "Spec v2" });
    // Mixed changes are atomic and the content token still fences a move.
    const mark = await cursor();
    expect(
      await status(owner, `/documents/${document.id}`, "PATCH", {
        folderId: crypto.randomUUID(),
        title: "never",
        editToken: filed.editToken,
      }),
    ).toBe(404);
    expect(
      await status(owner, `/documents/${document.id}`, "PATCH", {
        folderId: other.id,
        editToken: 0,
      }),
    ).toBe(409);
    expect((await call(owner, `/documents/${document.id}`)).title).toBe(
      "Spec v2",
    );
    expect(await cursor()).toBe(mark);
  });

  it("resolves concurrent first placement deterministically and never resets it on retry", async () => {
    const one = await folder(owner, "First one");
    const two = await folder(owner, "First two");
    const requestId = crypto.randomUUID();
    const [a, b] = await Promise.all([
      file(owner, "Racing", { requestId, folderId: one.id }),
      file(owner, "Racing", { requestId, folderId: two.id }),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.folderId).toBe(b.folderId);
    expect([one.id, two.id]).toContain(a.folderId);
    expect(
      (
        await database.pool.query(
          'select count(*)::int n from files where "requestId"=$1',
          [requestId],
        )
      ).rows[0]?.n,
    ).toBe(1);
  });

  it("keeps Project scope fixed and never lets a move widen or strand private data", async () => {
    const shared = await folder(owner, "Shared");
    const inProject = await folder(owner, "Scoped", { projectId });
    const priv = await folder(owner, "Private", { visibility: "user" });
    const publicFile = await file(owner, "Public file");
    const privateFile = await file(owner, "Private file", {
      visibility: "user",
    });
    // Project scope: a top-level File cannot enter a Project folder and vice versa.
    expect(
      await status(owner, `/files/${publicFile.id}`, "PATCH", {
        folderId: inProject.id,
      }),
    ).toBe(409);
    expect(
      (
        await call(owner, "/files", "POST", {
          requestId: crypto.randomUUID(),
          title: "Scoped",
          type: "note",
          mediaType: "text/plain",
          visibility: "workspace",
          projectId,
          bytes: "eA==",
          folderId: inProject.id,
        })
      ).folderId,
    ).toBe(inProject.id);
    expect(
      await status(owner, "/documents", "POST", {
        title: "d",
        body: "b",
        folderId: inProject.id,
      }),
    ).toBe(409);
    // A user folder holds only its creator's private items.
    expect(
      await status(owner, `/files/${publicFile.id}`, "PATCH", {
        folderId: priv.id,
      }),
    ).toBe(403);
    expect(
      (
        await call(owner, `/files/${privateFile.id}`, "PATCH", {
          folderId: priv.id,
        })
      ).folderId,
    ).toBe(priv.id);
    expect(
      await status(owner, `/files/${privateFile.id}`, "PATCH", {
        visibility: "workspace",
      }),
    ).toBe(403);
    expect(
      await status(owner, `/folders/${shared.id}`, "PATCH", {
        parentId: priv.id,
      }),
    ).toBe(403);
    // Narrowing a shared folder that holds a shared item is refused; a private-only folder may narrow.
    const mixed = await folder(owner, "Mixed");
    await call(owner, `/files/${publicFile.id}`, "PATCH", {
      folderId: mixed.id,
    });
    expect(
      await status(owner, `/folders/${mixed.id}`, "PATCH", {
        visibility: "user",
      }),
    ).toBe(409);
    const quiet = await folder(owner, "Quiet");
    await call(
      owner,
      `/files/${(await file(owner, "Own private", { visibility: "user" })).id}`,
      "PATCH",
      { folderId: quiet.id },
    );
    expect(
      (
        await call(owner, `/folders/${quiet.id}`, "PATCH", {
          visibility: "user",
        })
      ).visibility,
    ).toBe("user");
    // Another contributor cannot see, list, place into or learn about the private folder.
    expect(await status(peer, `/folders/${priv.id}`, "GET")).toBe(403);
    expect(
      (await call(peer, "/folders?root=true")).items.map(
        (f: { id: string }) => f.id,
      ),
    ).not.toContain(priv.id);
    expect(await status(peer, `/library?folderId=${priv.id}`, "GET")).toBe(403);
    const peerFile = await file(peer, "Peer file", { visibility: "user" });
    expect(
      await status(peer, `/files/${peerFile.id}`, "PATCH", {
        folderId: priv.id,
      }),
    ).toBe(403);
    // The private item stays directly reachable by its owner and absent from others, independent of the folder.
    expect((await call(owner, `/files/${privateFile.id}`)).folderId).toBe(
      priv.id,
    );
    expect(await status(peer, `/files/${privateFile.id}`, "GET")).toBe(403);
    // Other contributors can place their own item into a shared folder, and viewers cannot place anything.
    expect(
      (
        await call(peer, `/files/${peerFile.id}`, "PATCH", {
          folderId: shared.id,
        })
      ).folderId,
    ).toBe(shared.id);
    expect(
      await status(viewer, `/files/${publicFile.id}`, "PATCH", {
        folderId: shared.id,
      }),
    ).toBe(403);
    expect(
      await status(peer, `/files/${publicFile.id}`, "PATCH", {
        folderId: shared.id,
      }),
    ).toBe(403);
  });

  it("archives only truly empty folders and restores under a live parent", async () => {
    const parent = await folder(owner, "Parent");
    const child = await folder(owner, "Child", { parentId: parent.id });
    const mark = await cursor();
    expect(
      await status(owner, `/folders/${parent.id}/archive`, "POST", {
        archived: true,
      }),
    ).toBe(409);
    expect(await cursor()).toBe(mark);
    expect(
      await status(owner, `/folders/${child.id}/archive`, "POST", {
        archived: true,
      }),
    ).toBe(200);
    // An archived subfolder still blocks the parent: nothing is orphaned or hidden.
    expect(
      await status(owner, `/folders/${parent.id}/archive`, "POST", {
        archived: true,
      }),
    ).toBe(409);
    expect(
      await status(owner, `/folders/${child.id}/archive`, "POST", {
        archived: false,
      }),
    ).toBe(200);
    const held = await file(owner, "Held", { folderId: child.id });
    expect(
      await status(owner, `/folders/${child.id}/archive`, "POST", {
        archived: true,
      }),
    ).toBe(409);
    await call(owner, `/files/${held.id}/archive`, "POST", { archived: true });
    // An archived File is still a child.
    expect(
      await status(owner, `/folders/${child.id}/archive`, "POST", {
        archived: true,
      }),
    ).toBe(409);
    await call(owner, `/files/${held.id}`, "PATCH", { folderId: null });
    const document = await doc(owner, "Held doc");
    await call(owner, `/documents/${document.id}`, "PATCH", {
      folderId: child.id,
      editToken: 0,
    });
    expect(
      await status(owner, `/folders/${child.id}/archive`, "POST", {
        archived: true,
      }),
    ).toBe(409);
    await call(owner, `/documents/${document.id}`, "PATCH", {
      folderId: null,
      editToken: 1,
    });
    // Another contributor's item that the creator cannot see still blocks (hidden children count).
    const hidden = await file(peer, "Hidden", {
      folderId: child.id,
      visibility: "user",
    });
    expect((await call(owner, `/library?folderId=${child.id}`)).items).toEqual(
      [],
    );
    expect(
      await status(owner, `/folders/${child.id}/archive`, "POST", {
        archived: true,
      }),
    ).toBe(409);
    await call(peer, `/files/${hidden.id}`, "PATCH", { folderId: null });
    const archived = await call(owner, `/folders/${child.id}/archive`, "POST", {
      archived: true,
    });
    expect(archived.archived).toBe(true);
    expect((await call(owner, `/folders?parentId=${parent.id}`)).items).toEqual(
      [],
    );
    expect(
      (
        await call(owner, `/folders?parentId=${parent.id}&archived=true`)
      ).items.map((f: { id: string }) => f.id),
    ).toEqual([child.id]);
    // Placement into an archived or missing destination fails; restore needs a live parent.
    expect(
      await status(owner, `/files/${held.id}`, "PATCH", { folderId: child.id }),
    ).toBe(409);
    expect(
      await status(owner, `/files/${held.id}`, "PATCH", {
        folderId: crypto.randomUUID(),
      }),
    ).toBe(404);
    expect(
      await status(owner, `/folders/${child.id}/archive`, "POST", {
        archived: false,
      }),
    ).toBe(200);
  });

  it("pages the mixed library by kind with stable cursors, scopes roots by Project and filters inaccessible items", async () => {
    const root = await folder(owner, "Library root", { projectId });
    const subs = [
      await folder(owner, "s1", { parentId: root.id }),
      await folder(owner, "s2", { parentId: root.id }),
    ];
    const files = [] as { id: string }[];
    for (const title of ["f1", "f2", "f3"])
      files.push(
        await call(owner, "/files", "POST", {
          requestId: crypto.randomUUID(),
          title,
          type: "note",
          mediaType: "text/plain",
          visibility: "workspace",
          projectId,
          bytes: "eA==",
          folderId: root.id,
        }),
      );
    const docs = [
      await doc(owner, "d1", { projectId, folderId: root.id }),
      await doc(owner, "d2", { projectId, folderId: root.id }),
    ];
    await file(owner, "owner private", {
      visibility: "user",
      folderId: undefined,
    });
    const seen: { type: string; id: string }[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      const page = await call(
        owner,
        `/library?folderId=${root.id}&limit=3${after ? `&after=${encodeURIComponent(after)}` : ""}`,
      );
      expect(page.items.length).toBeLessThanOrEqual(3);
      expect(page.folder.path.map((p: { title: string }) => p.title)).toEqual([
        "Library root",
      ]);
      seen.push(...page.items);
      after = page.next ?? undefined;
      pages++;
    } while (after && pages < 10);
    expect(seen.map((i) => i.type)).toEqual([
      "folder",
      "folder",
      "file",
      "file",
      "file",
      "document",
      "document",
    ]);
    expect(new Set(seen.map((i) => i.id)).size).toBe(7);
    expect(seen.map((i) => i.id).sort()).toEqual(
      [...subs, ...files, ...docs].map((i) => i.id).sort(),
    );
    expect(seen.find((i) => i.type === "file")).toMatchObject({
      visibility: "workspace",
      folderId: root.id,
      projectId,
    });
    // The Project root and the workspace root are separate scopes.
    const projectRoot = await call(owner, `/library?projectId=${projectId}`);
    expect(projectRoot.items.map((i: { id: string }) => i.id)).toContain(
      root.id,
    );
    const workspaceRoot = await call(owner, "/library");
    expect(workspaceRoot.items.map((i: { id: string }) => i.id)).not.toContain(
      root.id,
    );
    expect(
      await status(
        owner,
        `/library?folderId=${root.id}&projectId=${crypto.randomUUID()}`,
        "GET",
      ),
    ).toBe(400);
    expect(await status(owner, "/library?after=bogus", "GET")).toBe(400);
    // A private document in a workspace folder is invisible to others but never breaks their page.
    const sharedParent = await folder(owner, "Mixed visibility");
    await doc(owner, "shared doc", { folderId: sharedParent.id });
    const hiddenDoc = await doc(owner, "private doc", { visibility: "user" });
    await call(owner, `/documents/${hiddenDoc.id}`, "PATCH", {
      folderId: sharedParent.id,
      editToken: 0,
    });
    const asPeer = await call(peer, `/library?folderId=${sharedParent.id}`);
    expect(asPeer.items.map((i: { title: string }) => i.title)).toEqual([
      "shared doc",
    ]);
    expect(
      await status(viewer, `/library?folderId=${sharedParent.id}`, "GET"),
    ).toBe(200);
  });

  it("keeps organization human-only and reads absent for foreign workspaces", async () => {
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: owner.id, agentId: crypto.randomUUID() },
        (c) => createFolder(c, { title: "agent", visibility: "workspace" }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const outsider = await human("outsider");
    const other = await folder(owner, "Visible only to members");
    expect(await status(outsider, `/folders/${other.id}`, "GET")).toBe(403);
    expect(
      await status(outsider, "/folders", "POST", {
        title: "x",
        visibility: "workspace",
      }),
    ).toBe(403);
    expect(await status(outsider, "/library", "GET")).toBe(403);
  });
});
