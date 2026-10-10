import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgent } from "../packages/agents/src";
import {
  createChat,
  createParticipant,
  getMessages,
} from "../packages/chats/src";
import { createConnection } from "../packages/connections/src";
import { connections } from "../packages/connections/src/schema";
import { createEnvironment } from "../packages/environments/src";
import {
  createCollection,
  createDocument,
  proposeDocumentChange,
  snapshotRunDocuments,
} from "../packages/library/src";
import { upsertProjectMember } from "../packages/projects/src";
import { admitRun, getRuns } from "../packages/runs/src";
import { runs } from "../packages/runs/src/schema";
import { createSchedule } from "../packages/schedules/src";
import { createSkill, proposeSkillChange } from "../packages/skills/src";
import { createSubscription } from "../packages/subscriptions/src";
import { setSubscriptionApiKey } from "../packages/subscriptions/src/server";
import {
  createTask,
  createTaskLink,
  createTimesheet,
} from "../packages/tasks/src";
import {
  type Human,
  type ListHarness,
  startListHarness,
} from "./fixtures/lists";
import { fixtureEncryptionKey } from "./fixtures/native-model";

type Items = { items: Record<string, unknown>[]; next: string | number | null };

describe("sorted and filtered discovery across every domain list, and Document/File labels, over HTTP and private PostgreSQL", () => {
  let h: ListHarness;
  let alice: Human;
  const get = (path: string, cookie?: string) =>
    h.api(`${h.base}${path}`, { cookie });
  const page = async (path: string, cookie?: string) => {
    const response = await get(path, cookie);
    expect(response.status, `${path} -> ${response.text}`).toBe(200);
    return response.body as Items;
  };
  const field = async (path: string, name: string, cookie?: string) =>
    (await page(path, cookie)).items.map((item) => item[name]);
  const mutate = (
    path: string,
    method: string,
    json: unknown,
    cookie?: string,
  ) => h.api(`${h.base}${path}`, { method, json, cookie });
  beforeAll(async () => {
    h = await startListHarness();
    alice = h.alice;
  }, 120000);
  afterAll(async () => {
    await h?.stop();
  });

  describe("labels", () => {
    it("starts older Documents at no labels and creates, edits, clears and filters Document labels", async () => {
      const projectId = await h.project("Doc labels");
      await h.database.pool.query(
        `insert into documents (id,"workspaceId",title,body,"createdBy","projectId") values (gen_random_uuid(),$1,'Legacy','b',$2,$3)`,
        [h.workspaceId, h.owner.id, projectId],
      );
      const legacy = (await page(`/documents?projectId=${projectId}`)).items[0];
      expect(legacy?.labels).toEqual([]);
      const create = (labels: unknown, extra: Json = {}) =>
        mutate("/documents", "POST", {
          title: "Labelled",
          body: "b",
          visibility: "workspace",
          projectId,
          labels,
          ...extra,
        });
      const made = await create([" alpha ", "Beta", "alpha"]);
      expect(made.status).toBe(200);
      const doc = made.body as {
        id: string;
        labels: string[];
        editToken: number;
      };
      // Trimmed, case preserved, duplicates kept as sent.
      expect(doc.labels).toEqual(["alpha", "Beta", "alpha"]);
      expect((await get(`/documents/${doc.id}`)).body).toMatchObject({
        labels: ["alpha", "Beta", "alpha"],
      });
      // Exact, case-sensitive single-label filter; labels are in the list projection.
      expect(
        await field(`/documents?projectId=${projectId}&label=alpha`, "id"),
      ).toEqual([doc.id]);
      expect(
        await field(`/documents?projectId=${projectId}&label=Beta`, "id"),
      ).toEqual([doc.id]);
      expect(
        await field(`/documents?projectId=${projectId}&label=beta`, "id"),
      ).toEqual([]);
      expect(
        await field(`/documents?projectId=${projectId}&label=alp`, "id"),
      ).toEqual([]);
      expect(
        await field(
          `/documents?projectId=${projectId}&label=alpha&visibility=user`,
          "id",
        ),
      ).toEqual([]);
      expect(
        (
          await get(
            `/documents?projectId=${projectId}&label=${"x".repeat(201)}`,
          )
        ).status,
      ).toBe(400);
      expect((await get(`/documents?label=a&label=b`)).status).toBe(400);
      // Bounds: 30 accepted, 31, empty and over-long refused with nothing created.
      expect(
        (await create(Array.from({ length: 30 }, (_, i) => `l${i}`))).status,
      ).toBe(200);
      for (const bad of [
        Array.from({ length: 31 }, (_, i) => `l${i}`),
        [""],
        ["  "],
        ["x".repeat(201)],
        "alpha",
        [1],
      ])
        expect((await create(bad)).status).toBe(400);
      // Partial edit: creator only, fenced by the edit token, bumps it, and clears with [].
      const stale = await mutate(`/documents/${doc.id}`, "PATCH", {
        labels: ["x"],
        editToken: doc.editToken + 5,
      });
      expect(stale.status).toBe(409);
      const denied = await mutate(
        `/documents/${doc.id}`,
        "PATCH",
        { labels: ["x"], editToken: doc.editToken },
        alice.cookie,
      );
      expect(denied.status).toBe(403);
      expect((await get(`/documents/${doc.id}`)).body).toMatchObject({
        labels: ["alpha", "Beta", "alpha"],
      });
      const edited = await mutate(`/documents/${doc.id}`, "PATCH", {
        labels: ["gamma"],
        editToken: doc.editToken,
      });
      expect(edited.body).toMatchObject({
        labels: ["gamma"],
        editToken: doc.editToken + 1,
        title: "Labelled",
      });
      const cleared = await mutate(`/documents/${doc.id}`, "PATCH", {
        labels: [],
        editToken: doc.editToken + 1,
      });
      expect(cleared.body).toMatchObject({
        labels: [],
        editToken: doc.editToken + 2,
      });
      expect(
        await field(`/documents?projectId=${projectId}&label=gamma`, "id"),
      ).toEqual([]);
      // A title-only edit leaves labels alone.
      await mutate(`/documents/${doc.id}`, "PATCH", {
        labels: ["keep"],
        editToken: doc.editToken + 2,
      });
      const renamed = await mutate(`/documents/${doc.id}`, "PATCH", {
        title: "Renamed",
        editToken: doc.editToken + 3,
      });
      expect(renamed.body).toMatchObject({
        labels: ["keep"],
        title: "Renamed",
      });
      expect(
        (
          await mutate(`/documents/${doc.id}`, "PATCH", {
            editToken: doc.editToken + 4,
          })
        ).status,
      ).toBe(400);
    });

    it("edits File labels without touching the accepted upload request, and a retry keeps later labels", async () => {
      const projectId = await h.project("File labels");
      const requestId = crypto.randomUUID();
      const bytes = Buffer.from("labelled bytes").toString("base64");
      const upload = (labels?: string[]) =>
        mutate("/files", "POST", {
          requestId,
          title: "Report",
          type: "report",
          mediaType: "text/plain",
          projectId,
          visibility: "workspace",
          bytes,
          ...(labels ? { labels } : {}),
        });
      // Create accepts the same 30 as update; the older create bound of 20 only widens.
      const thirty = Array.from({ length: 30 }, (_, i) => `t${i}`);
      const made = await upload(["q1", "q1"]);
      expect(made.status).toBe(200);
      const file = made.body as { id: string; labels: string[] };
      expect(file.labels).toEqual(["q1", "q1"]);
      const stored = async () =>
        (
          await h.database.pool.query(
            `select request::text as request, labels::text as labels from files where id=$1`,
            [file.id],
          )
        ).rows[0] as { request: string; labels: string };
      const accepted = (await stored()).request;
      expect(JSON.parse(accepted).labels).toEqual(["q1", "q1"]);
      const other = await mutate("/files", "POST", {
        requestId: crypto.randomUUID(),
        title: "Thirty",
        type: "report",
        mediaType: "text/plain",
        projectId,
        bytes,
        labels: thirty,
      });
      expect(other.status).toBe(200);
      expect(
        (
          await mutate("/files", "POST", {
            requestId: crypto.randomUUID(),
            title: "ThirtyOne",
            type: "report",
            mediaType: "text/plain",
            bytes,
            labels: [...thirty, "extra"],
          })
        ).status,
      ).toBe(400);
      // Custodian only, current audience only.
      const denied = await mutate(
        `/files/${file.id}`,
        "PATCH",
        { labels: ["x"] },
        alice.cookie,
      );
      expect(denied.status).toBe(403);
      const edited = await mutate(`/files/${file.id}`, "PATCH", {
        labels: ["q2", "Q2"],
      });
      expect(edited.body).toMatchObject({ labels: ["q2", "Q2"] });
      expect(
        await field(`/files?projectId=${projectId}&label=q2`, "id"),
      ).toEqual([file.id]);
      expect(
        await field(`/files?projectId=${projectId}&label=q1`, "id"),
      ).toEqual([]);
      expect(
        await field(`/files?projectId=${projectId}&label=q`, "id"),
      ).toEqual([]);
      // The immutable accepted request is byte-identical after the edit.
      expect((await stored()).request).toBe(accepted);
      // An exact retry resumes the same File and does not reset the later labels.
      const retry = await upload(["q1", "q1"]);
      expect(retry.body).toMatchObject({ id: file.id, labels: ["q2", "Q2"] });
      expect((await stored()).request).toBe(accepted);
      expect(
        (
          await h.database.pool.query(
            `select count(*)::int as n from files where "requestId"=$1`,
            [requestId],
          )
        ).rows[0],
      ).toEqual({ n: 1 });
      // A changed retry still conflicts: labels remain part of the stored identity.
      expect((await upload(["different"])).status).toBe(409);
      // Cleared labels remove it from the filter; a frozen share keeps the labels it was published with.
      const share = await mutate("/shares/preview", "POST", {
        selection: { type: "file", targetId: file.id, includeFile: false },
      });
      expect(share.status).toBe(200);
      const shareId = (share.body as { id: string }).id;
      const published = await mutate(`/shares/${shareId}/publish`, "POST", {
        editToken: (share.body as { editToken: number }).editToken,
      });
      expect(published.status).toBe(200);
      await mutate(`/files/${file.id}`, "PATCH", { labels: [] });
      expect(
        await field(`/files?projectId=${projectId}&label=q2`, "id"),
      ).toEqual([]);
      const publicShare = await h.api(`/shares/${shareId}`, { cookie: "" });
      expect(publicShare.text).toContain("q2");
      expect((await stored()).labels).toBe("[]");
    });

    it("filters the mixed library by one label across Files and Documents only", async () => {
      const projectId = await h.project("Library labels");
      const doc = await mutate("/documents", "POST", {
        title: "Notes",
        body: "b",
        projectId,
        visibility: "workspace",
        labels: ["shared"],
      });
      const file = await mutate("/files", "POST", {
        requestId: crypto.randomUUID(),
        title: "Output",
        type: "report",
        mediaType: "text/plain",
        projectId,
        visibility: "workspace",
        bytes: Buffer.from("x").toString("base64"),
        labels: ["shared", "only-file"],
      });
      await mutate("/folders", "POST", {
        title: "Folder",
        projectId,
        visibility: "workspace",
      });
      const all = await h.walk(`${h.base}/library`, { projectId });
      expect(all.items.map((item) => item.type)).toEqual([
        "folder",
        "file",
        "document",
      ]);
      const labelled = await h.walk(`${h.base}/library`, {
        projectId,
        label: "shared",
        sort: "title",
      });
      expect(labelled.items.map((item) => [item.type, item.labels])).toEqual([
        ["file", ["shared", "only-file"]],
        ["document", ["shared"]],
      ]);
      expect(labelled.ids).toEqual([
        (file.body as { id: string }).id,
        (doc.body as { id: string }).id,
      ]);
      const onlyFile = await h.walk(`${h.base}/library`, {
        projectId,
        label: "only-file",
      });
      expect(onlyFile.items.map((item) => item.type)).toEqual(["file"]);
      // A cursor from the Folder phase cannot be used once the label excludes Folders.
      expect(
        (
          await get(
            `/library?projectId=${projectId}&label=shared&after=folder:`,
          )
        ).status,
      ).toBe(400);
      expect(
        (await get(`/library?projectId=${projectId}&sort=bogus`)).status,
      ).toBe(400);
      expect(
        (await get(`/library?projectId=${projectId}&bogus=1`)).status,
      ).toBe(400);
    });
  });

  describe("domain lists", () => {
    it("sorts and filters Tasks inside an explicit Project and Timesheets with immutable ties", async () => {
      const projectId = await h.project("Tasks");
      const lonely = await h.project("Owner only tasks", false);
      const due = (day: number | null) =>
        day === null ? null : new Date(Date.UTC(2026, 5, day));
      const ids: string[] = [];
      await h.scope(h.owner, async (c) => {
        for (const [i, [title, day, status]] of (
          [
            ["Delta", 20, "todo"],
            ["alpha", null, "doing"],
            ["Charlie", 5, "todo"],
            ["bravo", 12, "done"],
          ] as const
        ).entries()) {
          const task = await createTask(c, {
            projectId,
            title,
            dueAt: due(day),
            assigneeUserIds: i % 2 ? [alice.id] : [],
          });
          ids.push(task.id);
          if (status !== "todo")
            await c.tx.execute(
              (await import("drizzle-orm"))
                .sql`update tasks set status=${status} where id=${task.id}`,
            );
        }
        await createTask(c, { projectId: lonely, title: "Hidden task" });
      });
      const titles = (q: string) =>
        field(`/tasks?projectId=${projectId}&${q}`, "title");
      expect(await titles("sort=title")).toEqual([
        "alpha",
        "bravo",
        "Charlie",
        "Delta",
      ]);
      expect(await titles("sort=title&order=desc")).toEqual([
        "Delta",
        "Charlie",
        "bravo",
        "alpha",
      ]);
      // Due dates ascending/descending with the undated Task last in both directions.
      expect(await titles("sort=dueAt")).toEqual([
        "Charlie",
        "bravo",
        "Delta",
        "alpha",
      ]);
      expect(await titles("sort=dueAt&order=desc")).toEqual([
        "Delta",
        "bravo",
        "Charlie",
        "alpha",
      ]);
      expect(await titles("status=todo&sort=dueAt")).toEqual([
        "Charlie",
        "Delta",
      ]);
      expect(
        await titles(
          `dueFrom=${encodeURIComponent("2026-06-05T00:00:00Z")}&dueTo=${encodeURIComponent("2026-06-20T00:00:00Z")}&sort=dueAt`,
        ),
      ).toEqual(["Charlie", "bravo"]);
      expect(await titles(`assigneeUserId=${alice.id}&sort=title`)).toEqual([
        "alpha",
        "bravo",
      ]);
      expect(
        await titles(
          `status=done&assigneeUserId=${alice.id}&ownerId=${h.owner.id}`,
        ),
      ).toEqual(["bravo"]);
      expect(await titles("status=done&sort=title&archived=true")).toEqual([]);
      const walked = await h.walk(`${h.base}/tasks`, {
        projectId,
        sort: "dueAt",
        order: "desc",
        limit: 1,
      });
      expect(walked.items.map((t) => t.title)).toEqual([
        "Delta",
        "bravo",
        "Charlie",
        "alpha",
      ]);
      // No workspace-wide Task discovery: the Project is mandatory and must be readable.
      expect((await get("/tasks?sort=title")).status).toBe(400);
      expect(
        (await get(`/tasks?projectId=${lonely}&sort=title`, alice.cookie))
          .status,
      ).toBe(403);
      // Task links: native sorts and a type filter.
      const task = ids[0] as string;
      await h.scope(h.owner, async (c) => {
        await createTaskLink(c, task, {
          type: "url",
          reference: "https://b.example",
        });
        await createTaskLink(c, task, {
          type: "url",
          reference: "https://a.example",
        });
      });
      expect(
        await field(`/tasks/${task}/links?sort=reference`, "reference"),
      ).toEqual(["https://a.example", "https://b.example"]);
      expect(
        await field(`/tasks/${task}/links?type=chat`, "reference"),
      ).toEqual([]);
      // Timesheets share one logging instant here; the tie-break keeps pages exact in either direction.
      const entries = await h.scope(h.owner, async (c) => {
        const out: string[] = [];
        for (const duration of [30, 10, 20, 10])
          out.push((await createTimesheet(c, { taskId: task, duration })).id);
        return out;
      });
      const byId = [...entries].sort();
      for (const [order, expected] of [
        ["asc", byId],
        ["desc", [...byId].reverse()],
      ] as const) {
        const walked = await h.walk(`${h.base}/timesheets`, {
          taskId: task,
          sort: "createdAt",
          order,
          limit: 1,
        });
        expect(walked.ids).toEqual(expected);
      }
      expect(
        await field(
          `/timesheets?taskId=${task}&sort=duration&order=desc&limit=1`,
          "duration",
        ),
      ).toEqual([30]);
    });

    it("lists Chats by title and time without exposing others' participant-only Chats, Participants and Sessions", async () => {
      await h.scope(h.owner, async (c) => {
        await createChat(c, { title: "zchat shared", visibility: "workspace" });
        await createChat(c, { title: "Achat shared", visibility: "workspace" });
        const mine = await createChat(c, {
          title: "Mchat private SECRETCHAT",
          visibility: "participants",
        });
        await createParticipant(c, mine.id, {
          userId: h.bob.id,
          role: "viewer",
        });
      });
      const q = "query=shared";
      expect(
        await field(`/chats?${q}&sort=title`, "title", alice.cookie),
      ).toEqual(["Achat shared", "zchat shared"]);
      expect(
        await field(`/chats?${q}&sort=title&order=desc`, "title", alice.cookie),
      ).toEqual(["zchat shared", "Achat shared"]);
      expect(
        await field(
          "/chats?query=private&visibility=participants&sort=title",
          "title",
          alice.cookie,
        ),
      ).toEqual([]);
      expect(
        await field(`/chats?${q}&sort=createdAt&order=desc&limit=1`, "title"),
      ).toHaveLength(1);
      expect(
        await field(
          `/chats?query=private&visibility=participants&createdBy=${h.owner.id}`,
          "title",
          h.bob.cookie,
        ),
      ).toEqual(["Mchat private SECRETCHAT"]);
      expect(
        await field(
          `/chats?query=private&sort=title&visibility=workspace`,
          "title",
          h.bob.cookie,
        ),
      ).toEqual([]);
      const walked = await h.walk(
        `${h.base}/chats`,
        { query: "shared", sort: "title", limit: 1 },
        alice.cookie,
      );
      expect(walked.items.map((c) => c.title)).toEqual([
        "Achat shared",
        "zchat shared",
      ]);
      expect(walked.bodies.join()).not.toMatch(/SECRETCHAT/i);
      const chatId = String(
        (await page(`/chats?query=private&sort=title`)).items[0]?.id,
      );
      expect(
        await field(
          `/chats/${chatId}/participants?sort=role&order=desc&role=viewer`,
          "userId",
        ),
      ).toEqual([h.bob.id]);
      expect(
        (
          await field(`/chats/${chatId}/participants?sort=type`, "userId")
        ).sort(),
      ).toEqual([h.owner.id, h.bob.id].sort());
      expect(
        await field(
          `/chats/${chatId}/participants?type=human&role=viewer`,
          "userId",
        ),
      ).toEqual([h.bob.id]);
      expect(
        await field(`/chats/${chatId}/participants?type=agent`, "userId"),
      ).toEqual([]);
      expect(
        await field(
          `/chats/${chatId}/sessions?sort=createdAt&order=desc`,
          "id",
        ),
      ).toEqual([]);
      // A non-participant gets nothing about the Chat, even from a sorted Participant or Session list.
      expect(
        (await get(`/chats/${chatId}/participants?sort=role`, alice.cookie))
          .status,
      ).toBe(403);
      // Message replay is a fixed numeric cursor and rejects sorting.
      expect((await get(`/chats/${chatId}/messages?after=0`)).status).toBe(200);
      expect(
        (await get(`/chats/${chatId}/messages?after=0&sort=title`)).status,
      ).toBe(400);
      const replay = await h.scope(
        h.owner,
        (c) => getMessages(c, chatId, 0, h.nativeStorage),
        false,
      );
      expect(replay).toEqual([]);
    });

    it("sorts and filters Agents, Skills, Collections, Folders and Files, keeping private rows out", async () => {
      const projectId = await h.project("Catalog");
      const subscriptionId = await h.scope(h.owner, async (c) => {
        const subscription = await createSubscription(c, {
          title: "Beta account",
          provider: "openai",
          protocol: "responses",
          models: ["m"],
          visibility: "workspace",
        });
        await setSubscriptionApiKey(
          c,
          subscription.id,
          { apiKey: "fixture-not-a-real-key" },
          fixtureEncryptionKey,
        );
        return subscription.id;
      });
      await h.scope(h.owner, async (c) => {
        await createAgent(c, {
          title: "Zed agent",
          instructions: "i",
          model: "m",
          visibility: "workspace",
          projectId,
        });
        await createAgent(c, {
          title: "alpha agent",
          instructions: "i",
          model: "m",
          visibility: "workspace",
          projectId,
          subscriptionId,
        });
        await createAgent(c, {
          title: "Private agent PRIVAGENT",
          instructions: "i",
          model: "m",
          visibility: "user",
          projectId,
        });
        await createSkill(c, {
          title: "Zed skill",
          instructions: "do",
          visibility: "workspace",
          projectId,
        });
        await createSkill(c, {
          title: "alpha skill",
          instructions: "do",
          visibility: "workspace",
          projectId,
        });
        await createSkill(c, {
          title: "Private skill PRIVSKILL",
          instructions: "do",
          visibility: "user",
          projectId,
        });
        await createCollection(c, {
          title: "Beta table",
          projectId,
          fields: [],
        });
        await createCollection(c, {
          title: "alpha table",
          projectId,
          fields: [],
        });
      });
      const names = (path: string, cookie?: string) =>
        field(path, "title", cookie);
      expect(
        await names(`/agents?projectId=${projectId}&sort=title`, alice.cookie),
      ).toEqual(["alpha agent", "Zed agent"]);
      expect(
        await names(
          `/agents?projectId=${projectId}&sort=title&order=desc`,
          alice.cookie,
        ),
      ).toEqual(["Zed agent", "alpha agent"]);
      expect(
        await names(
          `/agents?projectId=${projectId}&sort=title&visibility=user`,
          alice.cookie,
        ),
      ).toEqual([]);
      expect(
        await names(
          `/agents?projectId=${projectId}&sort=title&visibility=user`,
        ),
      ).toEqual(["Private agent PRIVAGENT"]);
      expect(
        await names(`/agents?projectId=${projectId}&query=zed`, alice.cookie),
      ).toEqual(["Zed agent"]);
      expect(
        await names(`/agents?projectId=${projectId}&createdBy=${h.bob.id}`),
      ).toEqual([]);
      expect(
        await names(`/skills?projectId=${projectId}&sort=title`, alice.cookie),
      ).toEqual(["alpha skill", "Zed skill"]);
      expect(
        await names(
          `/skills?projectId=${projectId}&sort=createdAt&order=desc&visibility=workspace&limit=1`,
          alice.cookie,
        ),
      ).toHaveLength(1);
      expect(
        await names(
          `/skills?projectId=${projectId}&createdBy=${h.owner.id}&sort=title&order=desc`,
        ),
      ).toEqual(
        ["Zed skill", "Private skill PRIVSKILL", "alpha skill"].sort((a, b) =>
          a.toLowerCase() < b.toLowerCase() ? 1 : -1,
        ),
      );
      expect(
        await names(`/collections?projectId=${projectId}&sort=title`),
      ).toEqual(["alpha table", "Beta table"]);
      expect(
        await names(`/collections?projectId=${projectId}&query=beta`),
      ).toEqual(["Beta table"]);
      const walked = await h.walk(
        `${h.base}/agents`,
        { projectId, sort: "title", limit: 1 },
        alice.cookie,
      );
      expect(walked.bodies.join()).not.toMatch(/PRIVAGENT/);
      // Proposals: title sort and the proposer/agent filters; no timestamps are invented.
      const doc = (
        await h.scope(h.owner, (c) =>
          createDocument(c, {
            title: "Proposed",
            body: "b",
            visibility: "workspace",
            projectId,
          }),
        )
      ).id;
      await h.scope(alice, async (c) => {
        await proposeDocumentChange(c, doc, {
          title: "Zeta change",
          body: "b",
          editToken: 0,
        });
        await proposeDocumentChange(c, doc, {
          title: "alpha change",
          body: "b",
          editToken: 0,
        });
      });
      expect(await names(`/documents/${doc}/proposals?sort=title`)).toEqual([
        "alpha change",
        "Zeta change",
      ]);
      expect(
        await names(
          `/documents/${doc}/proposals?proposerId=${alice.id}&query=zeta`,
        ),
      ).toEqual(["Zeta change"]);
      expect(
        await names(`/documents/${doc}/proposals?proposerId=${h.bob.id}`),
      ).toEqual([]);
      const skill = String(
        (await page(`/skills?projectId=${projectId}&sort=title`)).items[0]?.id,
      );
      await h.scope(alice, (c) =>
        proposeSkillChange(c, skill, {
          title: "Skill change",
          instructions: "x",
          editToken: 0,
        }),
      );
      expect(await names(`/skills/${skill}/proposals?sort=title`)).toEqual([
        "Skill change",
      ]);
      // Folders and Files.
      await mutate("/folders", "POST", {
        title: "Zeta folder",
        projectId,
        visibility: "workspace",
      });
      await mutate("/folders", "POST", {
        title: "alpha folder",
        projectId,
        visibility: "workspace",
      });
      await mutate("/folders", "POST", {
        title: "Private folder",
        projectId,
        visibility: "user",
      });
      expect(
        await names(`/folders?projectId=${projectId}&sort=title`, alice.cookie),
      ).toEqual(["alpha folder", "Zeta folder"]);
      expect(
        await names(
          `/folders?projectId=${projectId}&visibility=user&sort=title`,
        ),
      ).toEqual(["Private folder"]);
      expect(
        await names(
          `/folders?projectId=${projectId}&createdBy=${h.owner.id}&query=zeta`,
        ),
      ).toEqual(["Zeta folder"]);
      for (const [title, size, type] of [
        ["big", 9, "log"],
        ["small", 1, "log"],
        ["mid", 5, "report"],
      ] as const)
        await mutate("/files", "POST", {
          requestId: crypto.randomUUID(),
          title,
          type,
          mediaType: "text/plain",
          projectId,
          visibility: "workspace",
          bytes: Buffer.from("x".repeat(size)).toString("base64"),
        });
      expect(
        await names(
          `/files?projectId=${projectId}&sort=byteLength`,
          alice.cookie,
        ),
      ).toEqual(["small", "mid", "big"]);
      expect(
        await names(`/files?projectId=${projectId}&sort=byteLength&order=desc`),
      ).toEqual(["big", "mid", "small"]);
      expect(
        await names(`/files?projectId=${projectId}&sort=title&type=log`),
      ).toEqual(["big", "small"]);
      expect(
        await names(
          `/files?projectId=${projectId}&ownerId=${h.owner.id}&visibility=workspace&sort=title&order=desc&limit=2`,
        ),
      ).toEqual(["small", "mid"]);
      expect(
        await names(`/files?projectId=${projectId}&ownerId=${h.bob.id}`),
      ).toEqual([]);
    });

    it("sorts and filters Connections, Subscriptions and Operations without exposing accounts or private rows", async () => {
      const connectionIds: string[] = [];
      await h.scope(h.owner, async (c) => {
        for (const [title, type, visibility] of [
          ["Zed hub", "github", "workspace"],
          ["alpha hub", "mcp", "workspace"],
          ["Private hub PRIVCONN", "github", "user"],
        ] as const) {
          const row = await createConnection(c, {
            title,
            type,
            accountRef: `ref-${title}`,
            visibility,
          });
          connectionIds.push(row.id);
        }
        await createSubscription(c, {
          title: "Zed seat",
          provider: "openai",
          protocol: "responses",
          models: ["m"],
          visibility: "workspace",
        });
        await createSubscription(c, {
          title: "alpha seat",
          provider: "openai",
          protocol: "responses",
          models: ["m"],
          visibility: "workspace",
        });
        await createSubscription(c, {
          title: "Private seat PRIVSUB",
          provider: "openai",
          protocol: "responses",
          models: ["m"],
          visibility: "user",
        });
      });
      await h.database.db
        .update(connections)
        .set({ connected: true })
        .where(eq(connections.id, connectionIds[0] as string));
      const names = (path: string, cookie?: string) =>
        field(path, "title", cookie);
      expect(await names("/connections?sort=title", alice.cookie)).toEqual([
        "alpha hub",
        "Zed hub",
      ]);
      expect(
        await names("/connections?sort=title&order=desc", alice.cookie),
      ).toEqual(["Zed hub", "alpha hub"]);
      expect(
        await names("/connections?type=github&sort=title", alice.cookie),
      ).toEqual(["Zed hub"]);
      expect(await names("/connections?connected=true&sort=title")).toEqual([
        "Zed hub",
      ]);
      expect(await names("/connections?visibility=user&sort=title")).toEqual([
        "Private hub PRIVCONN",
      ]);
      expect(
        await names("/connections?visibility=user&sort=title", alice.cookie),
      ).toEqual([]);
      expect(await names("/connections?query=alpha", alice.cookie)).toEqual([
        "alpha hub",
      ]);
      expect(
        await names(`/connections?createdBy=${h.owner.id}&type=mcp`),
      ).toEqual(["alpha hub"]);
      expect((await get("/connections?accountRef=ref-Zed%20hub")).status).toBe(
        400,
      );
      expect(
        await names("/subscriptions?query=seat&sort=title", alice.cookie),
      ).toEqual(["alpha seat", "Zed seat"]);
      expect(
        await names(
          "/subscriptions?query=seat&status=needs_auth&provider=openai&sort=title&order=desc&limit=1",
          alice.cookie,
        ),
      ).toEqual(["Zed seat"]);
      expect(
        await names("/subscriptions?status=enabled", alice.cookie),
      ).toEqual(["Beta account"]);
      expect(
        await names("/subscriptions?query=seat&status=enabled", alice.cookie),
      ).toEqual([]);
      expect(await names("/subscriptions?visibility=user&query=seat")).toEqual([
        "Private seat PRIVSUB",
      ]);
      expect(
        await names(
          `/subscriptions?query=zed&createdBy=${h.owner.id}`,
          alice.cookie,
        ),
      ).toEqual(["Zed seat"]);
      for (const path of [
        "/connections?sort=title&limit=1",
        "/subscriptions?sort=title&limit=1",
      ]) {
        const walked = await h.walk(
          `${h.base}${path.split("?")[0]}`,
          { sort: "title", limit: 1 },
          alice.cookie,
        );
        expect(walked.bodies.join()).not.toMatch(/PRIVCONN|PRIVSUB|ref-/);
        expect(walked.bodies.join()).not.toMatch(/accountRef|credentialRef/);
      }
      // Operations (sponsor-only): sorted by their real timestamps.
      const { agentId, chatId } = await h.scope(h.owner, async (c) => {
        const chat = await createChat(c, {
          title: "ops",
          visibility: "participants",
        });
        const agent = await createAgent(c, {
          title: "ops agent",
          instructions: "i",
          model: "m",
          visibility: "workspace",
        });
        await createParticipant(c, chat.id, {
          agentId: agent.id,
          role: "contributor",
        });
        await createEnvironment(c, agent.id);
        return { agentId: agent.id, chatId: chat.id };
      });
      const run = await h.scope(h.owner, (c) =>
        admitRun(
          c,
          h.boss,
          {
            requestId: crypto.randomUUID(),
            chatId,
            agentId,
            type: "script",
            body: "x",
          },
          undefined,
          undefined,
          snapshotRunDocuments,
        ),
      );
      for (const [n, state] of [
        [1, "awaiting_approval"],
        [2, "succeeded"],
        [3, "awaiting_approval"],
      ] as const)
        await h.database.pool.query(
          `insert into connection_operations (id,"workspaceId","connectionId","agentId","sponsorId","runId","requestId",action,target,"accountRef",state,"createdAt","updatedAt")
           values (gen_random_uuid(),$1,$2,$3,$4,$5,gen_random_uuid(),'read','repo','ref',$6,$7::timestamptz,$7::timestamptz)`,
          [
            h.workspaceId,
            connectionIds[0],
            agentId,
            h.owner.id,
            run.id,
            state,
            `2026-04-0${n}T00:00:00Z`,
          ],
        );
      const created = async (q: string) =>
        (
          await page(`/connections/${connectionIds[0]}/operations?${q}`)
        ).items.map((o) => String(o.createdAt).slice(0, 10));
      expect(await created("sort=createdAt&order=desc")).toEqual([
        "2026-04-03",
        "2026-04-02",
        "2026-04-01",
      ]);
      expect(await created("state=awaiting_approval&sort=createdAt")).toEqual([
        "2026-04-01",
        "2026-04-03",
      ]);
      expect(await created("state=failed")).toEqual([]);
      expect(await created("limit=1")).toHaveLength(1);
      const walkedOps = await h.walk(
        `${h.base}/connections/${connectionIds[0]}/operations`,
        { sort: "updatedAt", order: "desc", limit: 1 },
      );
      expect(
        walkedOps.items.map((o) => String(o.createdAt).slice(0, 10)),
      ).toEqual(["2026-04-03", "2026-04-02", "2026-04-01"]);
      expect(
        await page(
          `/connections/${connectionIds[0]}/operations`,
          alice.cookie,
        ).then((r) => r.items),
      ).toEqual([]);
    });

    it("sorts and filters Schedules, their history and Runs, keeping replay by commit cursor", async () => {
      const { agentId, chatId } = await h.scope(h.owner, async (c) => {
        const chat = await createChat(c, {
          title: "runs",
          visibility: "participants",
        });
        const agent = await createAgent(c, {
          title: "run agent",
          instructions: "i",
          model: "m",
          visibility: "workspace",
        });
        await createParticipant(c, chat.id, {
          agentId: agent.id,
          role: "contributor",
        });
        await createEnvironment(c, agent.id);
        return { agentId: agent.id, chatId: chat.id };
      });
      const runIds: string[] = [];
      await h.scope(h.owner, async (c) => {
        for (const type of ["script", "script", "script"] as const)
          runIds.push(
            (
              await admitRun(
                c,
                h.boss,
                {
                  requestId: crypto.randomUUID(),
                  chatId,
                  agentId,
                  type,
                  body: "x",
                },
                undefined,
                undefined,
                snapshotRunDocuments,
              )
            ).id,
          );
      });
      await h.database.pool.query(
        `update runs set "createdAt"=timestamptz '2026-05-01T00:00:00Z' + (array_position($1::uuid[], id)) * interval '1 hour', state=case when id=$2 then 'failed' else state end where id = any($1)`,
        [runIds, runIds[1]],
      );
      const order = (q: string) => field(`/runs?chatId=${chatId}&${q}`, "id");
      expect(await order("sort=createdAt&order=desc")).toEqual(
        [...runIds].reverse(),
      );
      expect(await order("sort=createdAt")).toEqual(runIds);
      expect(await order("state=failed")).toEqual([runIds[1]]);
      expect(
        await order(
          `agentId=${agentId}&type=script&state=queued&sort=createdAt&order=desc`,
        ),
      ).toEqual([runIds[2], runIds[0]]);
      expect(await order("type=prompt")).toEqual([]);
      expect(
        await order(
          `sponsorId=${h.owner.id}&state=queued&sort=createdAt&limit=1`,
        ),
      ).toEqual([runIds[0]]);
      expect(await order("sponsorId=nobody")).toEqual([]);
      const walked = await h.walk(`${h.base}/runs`, {
        chatId,
        sort: "createdAt",
        order: "desc",
        limit: 1,
      });
      expect(walked.ids).toEqual([...runIds].reverse());
      // Replay: the numeric commit cursor still orders by cursor and refuses sort/filter mixing.
      const replay = await h.scope(
        h.owner,
        (c) => getRuns(c, { chatId, cursor: 0, limit: 2 }),
        false,
      );
      expect(replay.items.map((r) => r.id)).toEqual(runIds.slice(0, 2));
      expect(typeof replay.next).toBe("number");
      for (const mix of [
        { sort: "createdAt" },
        { after: runIds[0] },
        { type: "script" as const },
      ])
        await expect(
          h.scope(
            h.owner,
            (c) => getRuns(c, { chatId, cursor: 0, ...mix }),
            false,
          ),
        ).rejects.toMatchObject({ code: "invalid" });
      const runRows = await h.database.db
        .select({ id: runs.id })
        .from(runs)
        .where(eq(runs.chatId, chatId));
      expect(runRows).toHaveLength(3);
      // Schedules and their history.
      const mk = (
        title: string,
        status: "enabled" | "disabled",
        type: "prompt" | "script",
      ) =>
        h.scope(h.owner, (c) =>
          createSchedule(c, h.boss, {
            title,
            agentId,
            chatId,
            type,
            body: "go",
            status,
            timezone: "UTC",
            ...(status === "enabled" ? { cron: "0 0 1 1 *" } : {}),
          }),
        );
      const zed = await mk("Zed nightly", "enabled", "prompt");
      await mk("alpha weekly", "disabled", "script");
      const titles = (q: string, cookie?: string) =>
        field(`/schedules?${q}`, "title", cookie);
      expect(await titles("sort=title")).toEqual([
        "alpha weekly",
        "Zed nightly",
      ]);
      expect(await titles("sort=title&order=desc")).toEqual([
        "Zed nightly",
        "alpha weekly",
      ]);
      expect(await titles("status=enabled")).toEqual(["Zed nightly"]);
      expect(
        await titles(`ownerId=${h.owner.id}&type=script&sort=title`),
      ).toEqual(["alpha weekly"]);
      expect(await titles(`agentId=${agentId}&query=nightly`)).toEqual([
        "Zed nightly",
      ]);
      expect(await titles("ownerId=nobody")).toEqual([]);
      expect(await titles("sort=title", alice.cookie)).toEqual([]);
      const history = (n: number, outcome: string) =>
        h.database.pool.query(
          `insert into schedule_history (id,"scheduleId",outcome,"receivedAt") values (gen_random_uuid(),$1,$2,$3::timestamptz)`,
          [zed.id, outcome, `2026-06-0${n}T00:00:00Z`],
        );
      await history(1, "launched");
      await history(2, "skipped");
      await history(3, "launched");
      const received = (q: string) =>
        field(`/schedules/${zed.id}/history?${q}`, "outcome");
      expect(await received("sort=receivedAt&order=desc")).toEqual([
        "launched",
        "skipped",
        "launched",
      ]);
      expect(await received("outcome=skipped")).toEqual(["skipped"]);
      expect(await received("outcome=missing")).toEqual([]);
      const wh = await h.walk(`${h.base}/schedules/${zed.id}/history`, {
        sort: "receivedAt",
        limit: 1,
      });
      expect(wh.items.map((i) => String(i.receivedAt).slice(0, 10))).toEqual([
        "2026-06-01",
        "2026-06-02",
        "2026-06-03",
      ]);
      // The attention composition keeps four independent id cursors and no sort.
      expect((await get("/attention?limit=1")).status).toBe(200);
      expect((await get("/attention?sort=title")).status).toBe(400);
    });

    it("sorts and filters Workspaces, Members and Project members by name and role", async () => {
      const projectId = await h.project("Roster");
      const workspaces = await h.api("/workspaces?sort=title");
      expect(workspaces.status).toBe(200);
      expect((workspaces.body as Items).items.map((w) => w.title)).toContain(
        "Lists",
      );
      expect(
        (await h.api("/workspaces?role=owner&query=lists")).body,
      ).toMatchObject({ items: [{ title: "Lists", role: "owner" }] });
      expect((await h.api("/workspaces?role=viewer")).body).toMatchObject({
        items: [],
      });
      expect((await h.api("/workspaces?role=superuser")).status).toBe(400);
      expect(await field("/members?sort=name", "name")).toEqual([
        "alice",
        "bob",
        "owner",
      ]);
      expect(
        await field("/members?sort=name&order=desc&limit=2", "name"),
      ).toEqual(["owner", "bob"]);
      expect(
        await field("/members?role=contributor&sort=name", "name"),
      ).toEqual(["alice", "bob"]);
      expect(await field("/members?query=bob", "userId")).toEqual([h.bob.id]);
      expect(await field("/members?role=admin", "userId")).toEqual([]);
      const walked = await h.walk(`${h.base}/members`, {
        sort: "name",
        order: "desc",
        limit: 1,
      });
      expect(walked.items.map((m) => m.name)).toEqual([
        "owner",
        "bob",
        "alice",
      ]);
      expect(
        (
          await h.api(`${h.base}/members?sort=name&limit=1`, {
            cookie: h.outsider.cookie,
          })
        ).status,
      ).toBe(403);
      await h.scope(h.owner, (c) =>
        upsertProjectMember(c, projectId, h.owner.id, "contributor").catch(
          () => undefined,
        ),
      );
      expect(
        await field(`/projects/${projectId}/members?sort=name`, "name"),
      ).toEqual(["alice", "bob", "owner"]);
      expect(
        await field(
          `/projects/${projectId}/members?sort=name&order=desc`,
          "name",
          alice.cookie,
        ),
      ).toEqual(["owner", "bob", "alice"]);
      expect(
        await field(
          `/projects/${projectId}/members?role=contributor&query=alice`,
          "userId",
        ),
      ).toEqual([alice.id]);
      expect(
        await field(`/projects/${projectId}/members?role=viewer`, "userId"),
      ).toEqual([]);
      const walkedProject = await h.walk(
        `${h.base}/projects/${projectId}/members`,
        { sort: "name", limit: 1 },
      );
      expect(walkedProject.items.map((m) => m.name)).toEqual([
        "alice",
        "bob",
        "owner",
      ]);
      // Projects: only the caller's, sorted, searchable and archived-aware.
      const private1 = await h.project("zproject private", false);
      expect(
        await field("/projects?sort=title", "title", alice.cookie),
      ).not.toContain("zproject private");
      expect(
        await field("/projects?sort=title&order=desc&query=zproject", "title"),
      ).toEqual(["zproject private"]);
      expect(await field(`/projects?archived=true&sort=title`, "id")).toEqual(
        [],
      );
      expect(private1).toBeTruthy();
    });

    it("filters the publisher's Shares by state and type and keeps Share order by id", async () => {
      const projectId = await h.project("Shares");
      const doc = await mutate("/documents", "POST", {
        title: "Shared doc",
        body: "text here",
        visibility: "workspace",
        projectId,
      });
      const docId = (doc.body as { id: string }).id;
      const preview = await mutate("/shares/preview", "POST", {
        selection: { type: "document", targetId: docId, start: 0, end: 4 },
      });
      expect(preview.status).toBe(200);
      const first = preview.body as { id: string; editToken: number };
      const second = await mutate("/shares/preview", "POST", {
        selection: { type: "document", targetId: docId, start: 0, end: 3 },
      });
      await mutate(`/shares/${first.id}/publish`, "POST", {
        editToken: first.editToken,
      });
      const secondId = (second.body as { id: string }).id;
      expect(await field("/shares?published=true&type=document", "id")).toEqual(
        [first.id],
      );
      expect(
        await field("/shares?published=false&type=document", "id"),
      ).toEqual([secondId]);
      expect((await field("/shares?type=document", "id")).sort()).toEqual(
        [first.id, secondId].sort(),
      );
      // The File share published in the label test is the only File share, and it is published.
      expect(await field("/shares?type=file&published=false", "id")).toEqual(
        [],
      );
      expect(
        await field("/shares?type=file&published=true", "id"),
      ).toHaveLength(1);
      expect(await field("/shares?published=true", "id")).toHaveLength(2);
      expect(await field("/shares", "id", alice.cookie)).toEqual([]);
      expect((await get("/shares?sort=title")).status).toBe(400);
      expect((await get("/shares?type=url")).status).toBe(400);
    });
  });
});

type Json = Record<string, unknown>;
