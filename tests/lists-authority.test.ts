import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAgent } from "../packages/agents/src";
import { getChat } from "../packages/chats/src";
import { getConnection, getOperation } from "../packages/connections/src";
import { createCursorCodec } from "../packages/db/src";
import { getCollection, getDocument } from "../packages/documents/src";
import { createEnvironment } from "../packages/environments/src";
import { getFile, getFolder } from "../packages/files/src";
import { createProject, upsertProjectMember } from "../packages/projects/src";
import { admitRun, getRun } from "../packages/runs/src";
import { getSchedule } from "../packages/schedules/src";
import { DomainError } from "../packages/shared/src";
import { getSkill } from "../packages/skills/src";
import { getSubscription } from "../packages/subscriptions/src";
import { inWorkspace } from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import {
  type Human,
  LIST_SECRET,
  type ListHarness,
  startListHarness,
  uuid,
} from "./fixtures/lists";

type Actor = { userId: string; agentId?: string };
type Page = { items: { id: string }[]; next: string | number | null };
const prefix = "00000000-0000-4000-8300";
let n = 0;
const next = () => uuid(++n, prefix);

/**
 * The list SQL narrows to what the domain's own `getX` allows. For each distinct authority rule the set of ids a
 * complete walk returns (plain id order and both sorted orders) must equal the set `getX` allows, which also
 * proves a legitimate row is never suppressed and a denied row is never scanned (a sorted walk fails closed).
 */
describe("sorted and id-ordered lists return exactly the rows the domain authority allows", () => {
  let h: ListHarness;
  let owner: Human;
  let alice: Human;
  let bob: Human;
  let gone: Human;
  const codec = createCursorCodec(LIST_SECRET);
  const ids = {
    privateProject: "",
    aliceProject: "",
    agentX: "",
    agentY: "",
    chats: {} as Record<string, string>,
    runs: {} as Record<string, string>,
    connections: {} as Record<string, string>,
  };
  const exec = (text: string, values: unknown[] = []) =>
    h.database.pool.query(text, values);
  const as = <T>(actor: Actor, work: Parameters<typeof inWorkspace<T>>[3]) =>
    inWorkspace(h.database.db, h.workspaceId, actor, work, false, codec);
  const insert = async (
    table: string,
    columns: Record<string, unknown>,
  ): Promise<string> => {
    const row = { id: next(), workspaceId: h.workspaceId, ...columns };
    const names = Object.keys(row);
    await exec(
      `insert into ${table} (${names.map((name) => `"${name}"`).join(",")}) values (${names.map((_, i) => `$${i + 1}`).join(",")})`,
      Object.values(row),
    );
    return String(row.id);
  };
  const doc = (title: string, extra: Record<string, unknown> = {}) =>
    insert("documents", {
      title,
      body: "b",
      createdBy: owner.id,
      visibility: "workspace",
      ...extra,
    });

  beforeAll(async () => {
    h = await startListHarness();
    ({ owner, alice, bob } = h);
    gone = await h.signup("gone");
    await h.database.db.insert(members).values({
      workspaceId: h.workspaceId,
      userId: gone.id,
      role: "contributor",
    });
    const project = async (title: string, ...people: Human[]) =>
      h.scope(owner, async (c) => {
        const created = await createProject(c, { title });
        for (const person of people)
          await upsertProjectMember(c, created.id, person.id, "contributor");
        return created.id;
      });
    ids.privateProject = await project("Private");
    ids.aliceProject = await project("Alice", alice);
    const openProject = await project("Open", alice, bob);

    const agent = (title: string, extra: Record<string, unknown> = {}) =>
      insert("agents", {
        name: title,
        instructions: "i",
        model: "m",
        createdBy: owner.id,
        visibility: "workspace",
        ...extra,
      });
    ids.agentX = await agent("Agent X");
    ids.agentY = await agent("Agent Y");
    await agent("Private project agent", { projectId: ids.privateProject });
    await agent("Owner private agent", { visibility: "user" });
    await agent("Alice private agent", {
      visibility: "user",
      createdBy: alice.id,
    });
    await agent("Gone creator agent", { createdBy: gone.id });
    await agent("Open project agent", { projectId: openProject });

    // Documents, Folders, Skills, Collections: Project, creator membership and visibility.
    const selected: string[] = [];
    for (const [title, extra] of [
      ["workspace", {}],
      ["open project", { projectId: openProject }],
      ["private project", { projectId: ids.privateProject }],
      ["alice project", { projectId: ids.aliceProject }],
      ["owner user", { visibility: "user" }],
      ["alice user", { visibility: "user", createdBy: alice.id }],
      ["gone creator", { createdBy: gone.id }],
      [
        "alice in private project",
        { createdBy: alice.id, projectId: ids.privateProject },
      ],
    ] as const) {
      await doc(`doc ${title}`, extra);
      await insert("folders", {
        title: `folder ${title}`,
        createdBy: owner.id,
        visibility: "workspace",
        ...extra,
      });
      const skill = await insert("skills", {
        title: `skill ${title}`,
        instructions: "i",
        createdBy: owner.id,
        visibility: "workspace",
        ...extra,
      });
      if (
        ["workspace", "owner user", "gone creator", "alice user"].includes(
          title,
        )
      )
        selected.push(skill);
    }
    for (const [title, projectId] of [
      ["workspace", null],
      ["private project", ids.privateProject],
      ["alice project", ids.aliceProject],
    ] as const)
      await insert("collections", {
        title: `collection ${title}`,
        projectId,
        fields: "[]",
      });

    // Chats: workspace, participants (with/without alice), Project, and an Agent-only participant Chat.
    // `insert` adds workspaceId, which chat_participants does not have; insert those rows directly.
    const participant = (
      chatId: string,
      who: { userId?: string; agentId?: string },
    ) =>
      exec(
        `insert into chat_participants (id,"chatId","userId","agentId",role) values ($1,$2,$3,$4,'contributor')`,
        [next(), chatId, who.userId ?? null, who.agentId ?? null],
      );
    const makeChat = async (
      key: string,
      visibility: "workspace" | "participants",
      people: { userId?: string; agentId?: string }[],
      projectId: string | null = null,
    ) => {
      const id = await insert("chats", {
        title: `chat ${key}`,
        createdBy: owner.id,
        visibility,
        projectId,
      });
      for (const who of [{ userId: owner.id }, ...people])
        await participant(id, who);
      ids.chats[key] = id;
    };
    await makeChat("workspace", "workspace", [
      { agentId: ids.agentX },
      { agentId: ids.agentY },
    ]);
    await makeChat("with alice", "participants", [
      { userId: alice.id },
      { agentId: ids.agentX },
      { agentId: ids.agentY },
    ]);
    await makeChat("owner only", "participants", [
      { agentId: ids.agentX },
      { agentId: ids.agentY },
    ]);
    await makeChat(
      "private project",
      "workspace",
      [{ agentId: ids.agentX }, { agentId: ids.agentY }],
      ids.privateProject,
    );
    await makeChat(
      "open project",
      "participants",
      [{ userId: bob.id }, { agentId: ids.agentX }],
      openProject,
    );
    // Agent X is the only participant besides the owner; its sponsor Alice is not a human participant.
    await makeChat("agent only", "participants", [{ agentId: ids.agentX }]);
    await makeChat("alice agent chat", "participants", [{ userId: alice.id }]);

    // Schedules over those Chats.
    for (const [key, chatId] of Object.entries(ids.chats))
      await insert("schedules", {
        name: `schedule ${key}`,
        ownerId: owner.id,
        agentId: ids.agentX,
        chatId,
        type: "script",
        body: "b",
        status: "disabled",
      });

    // Runs (real admission) and Files whose saved audience is controlled explicitly.
    await h.scope(owner, async (c) => {
      for (const agentId of [ids.agentX]) await createEnvironment(c, agentId);
      for (const key of [
        "workspace",
        "with alice",
        "owner only",
        "agent only",
        "private project",
        "late alice",
        "late bob",
      ]) {
        const run = await admitRun(c, h.boss, {
          requestId: crypto.randomUUID(),
          chatId: ids.chats[
            { "late alice": "with alice", "late bob": "workspace" }[key] ?? key
          ] as string,
          agentId: ids.agentX,
          type: "script",
          body: "x",
        });
        ids.runs[key] = run.id;
      }
    });
    // Agent X selects these Skills only after its Runs were admitted (admission snapshots selected Skills).
    for (const skill of selected)
      await exec(
        `insert into agents_skills ("workspaceId","agentId","skillId") values ($1,$2,$3)`,
        [h.workspaceId, ids.agentX, skill],
      );
    const audience = (key: string, humans: string[], agents: string[]) =>
      exec(
        `update runs set inputs = jsonb_set(inputs,'{audience}', $2::jsonb) where id=$1`,
        [ids.runs[key], JSON.stringify({ humans, agents })],
      );
    await audience("workspace", [owner.id, alice.id, bob.id], [ids.agentX]);
    await audience("with alice", [owner.id, alice.id], [ids.agentX]);
    await audience("owner only", [owner.id], [ids.agentX]);
    await audience("agent only", [owner.id, alice.id], [ids.agentX]);
    await audience("private project", [owner.id, alice.id], []);
    // Readable now, but not in the SAVED audience (for example added to the Chat after the Run):
    // `late alice` also lists the Agent while leaving out its sponsor.
    await audience("late alice", [owner.id], [ids.agentX]);
    await audience("late bob", [owner.id, alice.id], [ids.agentX]);
    const file = (title: string, extra: Record<string, unknown> = {}) =>
      insert("files", {
        title,
        type: "t",
        ownerId: owner.id,
        requestId: crypto.randomUUID(),
        request: "{}",
        objectKey: `k-${next()}`,
        sha256: "x",
        byteLength: 1,
        mediaType: "text/plain",
        state: "saved",
        visibility: "workspace",
        ...extra,
      });
    await file("no source");
    await file("open project", { projectId: openProject });
    await file("private project", { projectId: ids.privateProject });
    await file("owner user", { visibility: "user" });
    await file("alice user", { visibility: "user", ownerId: alice.id });
    for (const key of [
      "workspace",
      "with alice",
      "owner only",
      "agent only",
      "private project",
      "late alice",
      "late bob",
    ])
      await file(`source ${key}`, { sourceRunId: ids.runs[key] });

    // Connections, Subscriptions and Operations: creator membership and visibility.
    for (const [title, createdBy, visibility] of [
      ["owner", owner.id, "workspace"],
      ["gone", gone.id, "workspace"],
      ["owner user", owner.id, "user"],
      ["alice user", alice.id, "user"],
    ] as const) {
      ids.connections[title] = await insert("connections", {
        name: `connection ${title}`,
        createdBy,
        visibility,
        type: "github",
        accountRef: `ref-${title}`,
        connected: false,
      });
      await insert("subscriptions", {
        name: `subscription ${title}`,
        createdBy,
        visibility,
        provider: "codex",
        status: "needs_auth",
      });
    }
    for (const [connection, sponsor] of [
      ["owner", owner.id],
      ["gone", owner.id],
      ["owner", alice.id],
      ["alice user", alice.id],
      ["owner user", owner.id],
    ] as const)
      await insert("connection_operations", {
        connectionId: ids.connections[connection],
        agentId: ids.agentX,
        sponsorId: sponsor,
        runId: ids.runs.workspace,
        requestId: crypto.randomUUID(),
        action: "read",
        target: "repo",
        accountRef: "ref",
        state: "awaiting_approval",
      });
    // Creators leave after creating their rows.
    await exec(
      `delete from workspace_members where "workspaceId"=$1 and "userId"=$2`,
      [h.workspaceId, gone.id],
    );
  }, 180000);
  afterAll(async () => {
    await h?.stop();
  });

  type Case = {
    name: string;
    table: string;
    where?: string;
    list: (
      c: Parameters<Parameters<typeof as>[1]>[0],
      filter: Record<string, unknown>,
    ) => Promise<Page>;
    single: (
      c: Parameters<Parameters<typeof as>[1]>[0],
      id: string,
    ) => Promise<unknown>;
    sorts: string[];
    agents: boolean;
  };
  const cases = async (): Promise<Case[]> => {
    const [
      { getDocuments },
      { getFiles, getFolders },
      { getAgents },
      { getSkills },
      { getCollections },
      { getChats },
      { getSchedules },
      { getRuns },
      { getConnections, getOperations },
      { getSubscriptions },
    ] = await Promise.all([
      import("../packages/documents/src"),
      import("../packages/files/src"),
      import("../packages/agents/src"),
      import("../packages/skills/src"),
      import("../packages/documents/src"),
      import("../packages/chats/src"),
      import("../packages/schedules/src"),
      import("../packages/runs/src"),
      import("../packages/connections/src"),
      import("../packages/subscriptions/src"),
    ]);
    return [
      {
        name: "Documents",
        table: "documents",
        list: getDocuments,
        single: getDocument,
        sorts: ["title"],
        agents: true,
      },
      {
        name: "Files",
        table: "files",
        where: `state='saved'`,
        list: getFiles,
        single: getFile,
        sorts: ["title"],
        agents: true,
      },
      {
        name: "Folders",
        table: "folders",
        list: getFolders,
        single: getFolder,
        sorts: ["title"],
        agents: false,
      },
      {
        name: "Agents",
        table: "agents",
        list: getAgents,
        single: getAgent,
        sorts: ["title"],
        agents: true,
      },
      {
        name: "Skills",
        table: "skills",
        list: getSkills,
        single: getSkill,
        sorts: ["title"],
        agents: true,
      },
      {
        name: "Collections",
        table: "collections",
        list: getCollections,
        single: getCollection,
        sorts: ["title"],
        agents: true,
      },
      {
        name: "Chats",
        table: "chats",
        list: getChats,
        single: getChat,
        sorts: ["title"],
        agents: true,
      },
      {
        name: "Schedules",
        table: "schedules",
        list: getSchedules,
        single: getSchedule,
        sorts: ["title"],
        agents: true,
      },
      {
        name: "Runs",
        table: "runs",
        list: getRuns,
        single: getRun,
        sorts: ["createdAt"],
        agents: true,
      },
      {
        name: "Connections",
        table: "connections",
        list: getConnections,
        single: getConnection,
        sorts: ["title"],
        agents: false,
      },
      {
        name: "Subscriptions",
        table: "subscriptions",
        list: getSubscriptions,
        single: getSubscription,
        sorts: ["title"],
        agents: false,
      },
      {
        name: "Operations",
        table: "connection_operations",
        list: getOperations,
        single: getOperation,
        sorts: ["createdAt"],
        agents: false,
      },
    ] as Case[];
  };
  const walk = async (
    testCase: Case,
    actor: Actor,
    filter: Record<string, unknown>,
  ) => {
    const seen: string[] = [];
    let after: string | undefined;
    for (let guard = 0; guard < 200; guard++) {
      const page = await as(actor, (c) =>
        testCase.list(c, { ...filter, limit: 3, ...(after ? { after } : {}) }),
      );
      seen.push(...page.items.map((item) => item.id));
      if (page.next === null) break;
      after = String(page.next);
    }
    return seen;
  };
  const allowed = async (testCase: Case, actor: Actor) => {
    const rows = await exec(
      `select id from ${testCase.table} where "workspaceId"=$1 ${testCase.where ? `and ${testCase.where}` : ""} order by id`,
      [h.workspaceId],
    );
    const ok: string[] = [];
    for (const { id } of rows.rows as { id: string }[])
      try {
        await as(actor, (c) => testCase.single(c, id));
        ok.push(id);
      } catch (error) {
        if (
          !(error instanceof DomainError) ||
          !["forbidden", "not_found"].includes(error.code)
        )
          throw error;
      }
    return { ok: ok.sort(), total: rows.rows.length };
  };

  it("lists exactly the rows getX allows, for every caller and every order", async () => {
    const actors = (): [string, Actor, boolean][] => [
      ["owner", { userId: owner.id }, false],
      ["alice", { userId: alice.id }, false],
      ["bob", { userId: bob.id }, false],
      ["agent X for alice", { userId: alice.id, agentId: ids.agentX }, true],
      ["agent X for owner", { userId: owner.id, agentId: ids.agentX }, true],
    ];
    const report: string[] = [];
    for (const testCase of await cases())
      for (const [label, actor, isAgent] of actors()) {
        if (isAgent && !testCase.agents) continue;
        const expected = await allowed(testCase, actor);
        for (const filter of [
          {},
          ...testCase.sorts.flatMap((sort) => [
            { sort },
            { sort, order: "desc" },
          ]),
        ]) {
          const listed = (await walk(testCase, actor, filter)).sort();
          expect(
            listed,
            `${testCase.name} as ${label} ${JSON.stringify(filter)}`,
          ).toEqual(expected.ok);
        }
        report.push(
          `${testCase.name} as ${label}: ${expected.ok.length}/${expected.total} readable`,
        );
      }
    console.info(report.join("\n"));
  }, 600000);

  it("covers the distinct rules: each case has both readable and denied rows, including the Agent and sponsor audience case", async () => {
    // Agent X (sponsor Alice) reads the participants-only Chat it belongs to, but Alice is not a human participant.
    const agentActor = { userId: alice.id, agentId: ids.agentX };
    const agentChats = await as(agentActor, async (c) => {
      const { getChats } = await import("../packages/chats/src");
      return (await getChats(c, {})).items.map((item) => item.id);
    });
    expect(agentChats).toContain(ids.chats["agent only"]);
    const sourceFile = await exec(
      `select id from files where "sourceRunId"=$1`,
      [ids.runs["agent only"]],
    );
    const fileId = (sourceFile.rows[0] as { id: string }).id;
    const { getFiles } = await import("../packages/files/src");
    // Saved audience contains Alice and the Agent and the Agent reads the Chat, yet the sponsor is not a current human participant.
    expect(
      (await as(agentActor, (c) => getFiles(c, {}))).items.map((i) => i.id),
    ).not.toContain(fileId);
    await expect(
      as(agentActor, (c) => getFile(c, fileId)),
    ).rejects.toMatchObject({ code: "forbidden" });
    // Saved audience: a human who can read the Chat now but was not in the Run's saved humans is denied, and an
    // Agent whose saved audience lists it but not its sponsor is denied too (getFile checks the sponsor's saved
    // membership), even though both can read the Chat today.
    const savedFile = async (key: string) =>
      (
        (
          await exec(`select id from files where "sourceRunId"=$1`, [
            ids.runs[key],
          ])
        ).rows[0] as { id: string }
      ).id;
    const lateAlice = await savedFile("late alice");
    const lateBob = await savedFile("late bob");
    for (const [actor, fileId] of [
      [{ userId: alice.id }, lateAlice],
      [agentActor, lateAlice],
      [{ userId: bob.id }, lateBob],
    ] as [Actor, string][]) {
      const listed = (await as(actor, (c) => getFiles(c, {}))).items.map(
        (i) => i.id,
      );
      expect(listed).not.toContain(fileId);
      for (const order of ["asc", "desc"])
        expect(
          (
            await as(actor, (c) =>
              getFiles(c, { sort: "title", order, limit: 2 }),
            )
          ).items.map((i) => i.id),
        ).not.toContain(fileId);
      await expect(as(actor, (c) => getFile(c, fileId))).rejects.toMatchObject({
        code: "forbidden",
      });
    }
    // The Chat itself is readable for each of them, so only the saved-audience clause denies.
    expect(agentChats).toContain(ids.chats["with alice"]);
    // Rows that must be readable for the right actor exist too (the equivalence above is not vacuous).
    const ownerFiles = (await as({ userId: owner.id }, (c) => getFiles(c, {})))
      .items;
    expect(ownerFiles.map((i) => i.id)).toContain(fileId);
    const creatorRemoved = await exec(
      `select id from connections where "workspaceId"=$1 and name='connection gone'`,
      [h.workspaceId],
    );
    const { getConnections, getOperations } = await import(
      "../packages/connections/src"
    );
    expect(
      (await as({ userId: owner.id }, (c) => getConnections(c, {}))).items.map(
        (i) => i.id,
      ),
    ).not.toContain((creatorRemoved.rows[0] as { id: string }).id);
    expect(
      (await as({ userId: owner.id }, (c) => getOperations(c, {}))).items,
    ).toHaveLength(2);
  });
});
