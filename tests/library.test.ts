import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCollection,
  createDocument,
  updateDocumentCollection,
} from "../packages/library/src";
import { type ListHarness, startListHarness } from "./fixtures/lists";

describe("one Library owner with SQL-scoped category browsing", () => {
  let h: ListHarness;
  beforeAll(async () => {
    h = await startListHarness();
  }, 60000);
  afterAll(async () => {
    await h?.stop();
  });

  const create = async (
    path: string,
    json: object,
    cookie = h.owner.cookie,
  ) => {
    const response = await h.api(`${h.base}${path}`, {
      method: "POST",
      json,
      cookie,
    });
    expect(response.status, response.text).toBe(200);
    return response.body as { id: string };
  };
  const file = (
    title: string,
    mediaType: string,
    projectId: string,
    extra: object = {},
    cookie = h.owner.cookie,
  ) =>
    create(
      "/files",
      {
        title,
        mediaType,
        projectId,
        type: "upload",
        requestId: crypto.randomUUID(),
        visibility: "workspace",
        bytes: "eA==",
        ...extra,
      },
      cookie,
    );

  it("includes project Documents at the workspace root and keeps folders navigable in every tab", async () => {
    const projectId = await h.project("Library categories");
    const folder = await create("/folders", {
      title: "Folder",
      projectId,
      visibility: "workspace",
    });
    const document = await create("/documents", {
      title: "Editable",
      body: "Saved body",
      projectId,
      visibility: "workspace",
    });
    const uploaded = await Promise.all([
      file("PDF", "application/pdf", projectId),
      file("Text", "text/plain; charset=utf-8", projectId),
      file(
        "Office",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        projectId,
      ),
      file("Image", "IMAGE/PNG", projectId),
      file("Video", "video/mp4", projectId),
      file("Audio", "audio/mpeg", projectId),
      file("Other", "application/zip", projectId),
    ]);
    const expected = {
      all: [folder.id, document.id, ...uploaded.map((row) => row.id)],
      documents: [
        folder.id,
        document.id,
        ...uploaded.slice(0, 3).map((row) => row.id),
      ],
      images: [folder.id, uploaded[3]?.id],
      video: [folder.id, uploaded[4]?.id],
      audio: [folder.id, uploaded[5]?.id],
      other: [folder.id, uploaded[6]?.id],
    };
    for (const [category, ids] of Object.entries(expected)) {
      const page = await h.walk(`${h.base}/library`, {
        category,
        projectId,
        limit: 2,
      });
      expect(page.ids.sort(), category).toEqual([...ids].sort());
    }
    const root = await h.walk(`${h.base}/library`, {
      category: "documents",
      limit: 2,
    });
    expect(root.ids).toContain(document.id);
    const child = await create("/documents", {
      title: "Nested",
      body: "b",
      projectId,
      folderId: folder.id,
      visibility: "workspace",
    });
    const nested = await h.walk(`${h.base}/library`, {
      category: "documents",
      folderId: folder.id,
    });
    expect(nested.ids).toEqual([child.id]);
    expect(root.ids).not.toContain(child.id);
  });

  it("filters before the SQL limit and seals both row and kind-boundary cursors to category, caller and filters", async () => {
    const projectId = await h.project("Category pagination");
    for (let i = 0; i < 105; i++)
      await file(`A distractor ${i}`, "application/zip", projectId);
    const images = await Promise.all([
      file("Z first", "image/png", projectId),
      file("Z second", "image/jpeg", projectId),
      file("Z third", "image/webp", projectId),
    ]);
    const walk = await h.walk(`${h.base}/library`, {
      category: "images",
      projectId,
      sort: "title",
      limit: 1,
    });
    expect(walk.ids.sort()).toEqual(images.map((row) => row.id).sort());
    const cursor = String(walk.pages[0]?.next);
    for (const suffix of [
      "category=other",
      `category=images&createdBy=${h.alice.id}`,
      "category=images&visibility=user",
    ]) {
      expect(
        (
          await h.api(
            `${h.base}/library?projectId=${projectId}&sort=title&after=${encodeURIComponent(cursor)}&${suffix}`,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await h.api(
          `${h.base}/library?projectId=${projectId}&category=images&sort=title&after=${encodeURIComponent(cursor)}`,
          { cookie: h.alice.cookie },
        )
      ).status,
    ).toBe(400);
    const folder = await create("/folders", {
      title: "First phase",
      projectId,
      visibility: "workspace",
    });
    const boundary = await h.api(
      `${h.base}/library?projectId=${projectId}&category=images&limit=1`,
    );
    const position = String((boundary.body as { next: string }).next);
    expect((boundary.body as { items: { id: string }[] }).items[0]?.id).toBe(
      folder.id,
    );
    expect(position.startsWith("file:")).toBe(true);
    expect(
      (
        await h.api(
          `${h.base}/library?projectId=${projectId}&category=other&after=${encodeURIComponent(position)}`,
        )
      ).status,
    ).toBe(400);
    for (const query of [
      "category=bogus",
      "category=images&unknown=1",
      "order=desc",
      "limit=101",
    ])
      expect((await h.api(`${h.base}/library?${query}`)).status).toBe(400);
  });

  it("preserves visibility/creator filters and makes collection browsing editable-Document-only", async () => {
    const projectId = await h.project("Library filters");
    const ownerFile = await file("Owner PDF", "application/pdf", projectId, {
      visibility: "user",
    });
    const peerFile = await file(
      "Peer PDF",
      "application/pdf",
      projectId,
      {},
      h.alice.cookie,
    );
    const records = await h.scope(h.owner, async (c) => {
      const document = await createDocument(c, {
        title: "Private",
        body: "b",
        projectId,
        visibility: "user",
      });
      const collection = await createCollection(c, {
        title: "Collection",
        projectId,
        fields: [],
      });
      await updateDocumentCollection(c, document.id, {
        collectionId: collection.id,
        properties: {},
        editToken: 0,
      });
      return { document, collection };
    });
    const privatePage = await h.walk(`${h.base}/library`, {
      category: "documents",
      projectId,
      createdBy: h.owner.id,
      visibility: "user",
    });
    expect(privatePage.ids.sort()).toEqual(
      [ownerFile.id, records.document.id].sort(),
    );
    const peerPage = await h.walk(
      `${h.base}/library`,
      { category: "documents", projectId },
      h.alice.cookie,
    );
    expect(peerPage.ids).toContain(peerFile.id);
    expect(peerPage.ids).not.toContain(ownerFile.id);
    expect(peerPage.ids).not.toContain(records.document.id);
    const collection = await h.walk(`${h.base}/library`, {
      category: "documents",
      projectId,
      collectionId: records.collection.id,
    });
    expect(collection.ids).toEqual([records.document.id]);
    expect(collection.items[0]?.collectionId).toBe(records.collection.id);
    expect(
      (await h.api(`${h.base}/library`, { cookie: h.outsider.cookie })).status,
    ).toBe(403);
  });
});
