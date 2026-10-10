import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorizeRunSources } from "../apps/server/src/run-sources";
import { createAgent } from "../packages/agents/src";
import {
  createChat,
  createMessage,
  createParticipant,
  deleteParticipant,
  isAttachedToReadableChat,
} from "../packages/chats/src";
import { participants } from "../packages/chats/src/schema";
import { createEnvironment } from "../packages/environments/src";
import {
  archiveDocument,
  createDocument,
  createFile,
  snapshotRunDocuments,
  updateDocument,
  updateFile,
} from "../packages/library/src";
import { files } from "../packages/library/src/schema";
import { deleteProjectMember } from "../packages/projects/src";
import { admitRun, validateRunSources } from "../packages/runs/src";
import { runs } from "../packages/runs/src/schema";
import type { SessionSource } from "../packages/sessions/src/schema";
import { required } from "../packages/shared/src";
import {
  createSkill,
  getSkill,
  setSkillFiles,
  updateSkill,
} from "../packages/skills/src";
import { createTask } from "../packages/tasks/src";
import { inWorkspace } from "../packages/workspaces/src";
import { type ListHarness, startListHarness } from "./fixtures/lists";
import { fixtureStorage } from "./fixtures/storage";

describe("retained Run source ledger against current domain authority", () => {
  let h: ListHarness;
  const objects = new Map<string, Uint8Array>();
  const storage = fixtureStorage({
    async put(key, bytes) {
      objects.set(key, bytes.slice());
    },
    async get(key) {
      return required(objects.get(key)).slice();
    },
  });
  beforeAll(async () => {
    h = await startListHarness();
  }, 60000);
  afterAll(async () => {
    await h?.stop();
  });

  const saved = async (id: string) =>
    required(
      (await h.database.db.select().from(runs).where(eq(runs.id, id)))[0],
    );
  const check = (run: typeof runs.$inferSelect, sources: SessionSource[]) =>
    inWorkspace(
      h.database.db,
      h.workspaceId,
      { userId: run.sponsorId, agentId: run.agentId },
      (c) => authorizeRunSources(c, run, sources),
      false,
    );
  async function setup(
    options: {
      skillIds?: string[];
      documentIds?: string[];
      projectId?: string;
      singleHuman?: boolean;
    } = {},
  ) {
    const projectId =
      options.projectId ?? (await h.project("Retained sources"));
    return h.scope(h.owner, async (c) => {
      const agent = await createAgent(c, {
        title: "Source checker",
        instructions: "No execution in this domain fixture",
        model: "unexecuted-fixture",
        visibility: "workspace",
        skillIds: options.skillIds,
      });
      await createEnvironment(c, agent.id);
      const chat = await createChat(c, {
        title: "Accepted source Chat",
        projectId,
        visibility: "participants",
      });
      if (!options.singleHuman)
        await createParticipant(c, chat.id, {
          userId: h.alice.id,
          role: "viewer",
        });
      await createParticipant(c, chat.id, {
        agentId: agent.id,
        role: "contributor",
      });
      const run = await admitRun(
        c,
        h.boss,
        {
          chatId: chat.id,
          agentId: agent.id,
          requestId: crypto.randomUUID(),
          type: "script",
          body: "Unexecuted authorization fixture",
          documentIds: options.documentIds,
        },
        undefined,
        undefined,
        snapshotRunDocuments,
      );
      return { projectId, chat, agent, runId: run.id };
    });
  }
  const file = (visibility: "user" | "workspace" = "workspace") =>
    createFile(
      h.database.db,
      storage,
      h.workspaceId,
      { userId: h.owner.id },
      {
        requestId: crypto.randomUUID(),
        title: "Retained bytes",
        type: "text",
        mediaType: "text/plain",
        visibility,
      },
      new TextEncoder().encode("immutable supporting bytes"),
    );

  it("requires Library composition for selected Documents and preserves accepted bytes through edits, archive and revocation", async () => {
    const fixture = await setup();
    const document = await h.scope(h.owner, (c) =>
      createDocument(c, {
        title: "Selected",
        body: "Accepted body",
        projectId: fixture.projectId,
        visibility: "workspace",
      }),
    );
    const input = {
      chatId: fixture.chat.id,
      agentId: fixture.agent.id,
      requestId: crypto.randomUUID(),
      type: "script" as const,
      body: "Selected context",
      documentIds: [document.id],
    };
    await expect(
      h.scope(h.owner, (c) => admitRun(c, h.boss, input)),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(
      await h.database.db
        .select()
        .from(runs)
        .where(eq(runs.requestId, input.requestId)),
    ).toEqual([]);
    const admitted = await h.scope(h.owner, (c) =>
      admitRun(c, h.boss, input, undefined, undefined, snapshotRunDocuments),
    );
    const accepted = await saved(admitted.id);
    const validate = (phase: "launch" | "continue", composed = true) =>
      h.scope(
        h.owner,
        (c) =>
          validateRunSources(
            c,
            accepted,
            undefined,
            phase,
            h.nativeStorage,
            composed ? snapshotRunDocuments : undefined,
          ),
        false,
      );
    await expect(validate("continue", false)).rejects.toMatchObject({
      code: "unavailable",
    });
    await h.scope(h.owner, (c) =>
      updateDocument(c, document.id, { body: "Current body", editToken: 0 }),
    );
    await expect(validate("launch")).resolves.toBeUndefined();
    expect((await saved(admitted.id)).inputs.context?.documents).toEqual([
      {
        id: document.id,
        title: "Selected",
        body: "Accepted body",
        editToken: 0,
      },
    ]);
    await h.scope(h.owner, (c) => archiveDocument(c, document.id, true, 1));
    await expect(validate("launch")).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(validate("continue")).resolves.toBeUndefined();
    await h.scope(h.owner, (c) =>
      updateDocument(c, document.id, { visibility: "user", editToken: 2 }),
    );
    await expect(validate("continue")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect((await saved(admitted.id)).inputs.context?.documents[0]?.body).toBe(
      "Accepted body",
    );
  });
  async function attach(chatId: string, fileId: string) {
    return createMessage(
      h.database.db,
      h.nativeStorage,
      h.workspaceId,
      { userId: h.owner.id },
      chatId,
      {
        requestId: crypto.randomUUID(),
        body: "Attached source",
        fileIds: [fileId],
      },
    );
  }
  async function skillFixture() {
    const sourceFile = await file();
    const skill = await h.scope(h.owner, async (c) => {
      const created = await createSkill(c, {
        title: "Retained Skill",
        instructions: "Read the supporting file",
        visibility: "workspace",
      });
      return setSkillFiles(
        c,
        created.id,
        [
          {
            path: "references/source.txt",
            fileId: sourceFile.id,
            sha256: sourceFile.sha256,
            byteLength: sourceFile.byteLength,
          },
        ],
        created.editToken,
      );
    });
    const fixture = await setup({ skillIds: [skill.id] });
    const source: Extract<SessionSource, { type: "skill-file" }> = {
      type: "skill-file",
      skillId: skill.id,
      path: "references/source.txt",
      fileId: sourceFile.id,
      sha256: sourceFile.sha256,
      byteLength: sourceFile.byteLength,
    };
    return {
      ...fixture,
      skill,
      sourceFile,
      source,
      run: await saved(fixture.runId),
    };
  }

  it("allows current same-Project Documents and Tasks, but refuses other Projects and unscoped Documents", async () => {
    const fixture = await setup();
    const otherProject = await h.project("Other readable Project");
    const sources = await h.scope(h.owner, async (c) => ({
      document: await createDocument(c, {
        title: "Current",
        body: "current",
        projectId: fixture.projectId,
        visibility: "workspace",
      }),
      task: await createTask(c, {
        title: "Current",
        projectId: fixture.projectId,
      }),
      otherDocument: await createDocument(c, {
        title: "Outside",
        body: "outside",
        projectId: otherProject,
        visibility: "workspace",
      }),
      otherTask: await createTask(c, {
        title: "Outside",
        projectId: otherProject,
      }),
      unscoped: await createDocument(c, {
        title: "Workspace",
        body: "outside",
        visibility: "workspace",
      }),
    }));
    const run = await saved(fixture.runId);
    await expect(
      check(run, [
        { type: "document", id: sources.document.id },
        { type: "task", id: sources.task.id },
      ]),
    ).resolves.toBeUndefined();
    for (const source of [
      { type: "document", id: sources.otherDocument.id },
      { type: "document", id: sources.unscoped.id },
      { type: "task", id: sources.otherTask.id },
    ] satisfies SessionSource[]) {
      await expect(check(run, [source])).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });

  it("preserves explicitly selected cross-Project Documents but rechecks their current privacy", async () => {
    const projectId = await h.project("Explicit selection");
    const doc = await h.scope(h.owner, (c) =>
      createDocument(c, {
        title: "Selected",
        body: "frozen body",
        projectId,
        visibility: "workspace",
      }),
    );
    const fixture = await setup({ documentIds: [doc.id] });
    const run = await saved(fixture.runId);
    expect(run.inputs.context?.documents).toEqual([
      expect.objectContaining({ id: doc.id, body: "frozen body" }),
    ]);
    await expect(
      check(run, [{ type: "document", id: doc.id }]),
    ).resolves.toBeUndefined();
    await h.scope(h.owner, (c) =>
      updateDocument(c, doc.id, {
        visibility: "user",
        editToken: doc.editToken,
      }),
    );
    await expect(
      check(run, [{ type: "document", id: doc.id }]),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("preserves a selected private Document for its sole human sponsor without granting dynamic reads or wider admission", async () => {
    const projectId = await h.project("Private selected Document");
    const doc = await h.scope(h.owner, (c) =>
      createDocument(c, {
        title: "Owner-only selection",
        body: "Private accepted body",
        projectId,
        visibility: "user",
      }),
    );
    const selected = await setup({
      projectId,
      documentIds: [doc.id],
      singleHuman: true,
    });
    const run = await saved(selected.runId);
    expect(run.inputs.audience.humans).toEqual([h.owner.id]);
    expect(run.inputs.audience.agents).toEqual([selected.agent.id]);
    expect(run.inputs.context?.documents).toEqual([
      expect.objectContaining({ id: doc.id, body: "Private accepted body" }),
    ]);
    await expect
      .soft(check(run, [{ type: "document", id: doc.id }]))
      .resolves.toBeUndefined();

    const dynamic = await setup({ projectId, singleHuman: true });
    await expect(
      check(await saved(dynamic.runId), [{ type: "document", id: doc.id }]),
    ).rejects.toMatchObject({ code: "forbidden" });

    const foreign = await h.scope(h.alice, (c) =>
      createDocument(c, {
        title: "Another human's private Document",
        body: "Not the sponsor's content",
        projectId,
        visibility: "user",
      }),
    );
    await expect(
      h.scope(h.owner, (c) =>
        admitRun(
          c,
          h.boss,
          {
            chatId: selected.chat.id,
            agentId: selected.agent.id,
            requestId: crypto.randomUUID(),
            type: "script",
            body: "Invalid private selection",
            documentIds: [foreign.id],
          },
          undefined,
          undefined,
          snapshotRunDocuments,
        ),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    await h.scope(h.owner, (c) =>
      createParticipant(c, selected.chat.id, {
        userId: h.alice.id,
        role: "viewer",
      }),
    );
    await expect(
      h.scope(h.owner, (c) =>
        admitRun(
          c,
          h.boss,
          {
            chatId: selected.chat.id,
            agentId: selected.agent.id,
            requestId: crypto.randomUUID(),
            type: "script",
            body: "Invalid widened selection",
            documentIds: [doc.id],
          },
          undefined,
          undefined,
          snapshotRunDocuments,
        ),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("requires every accepted human to retain Document and Task Project access, not just the sponsor", async () => {
    const fixture = await setup();
    const sources = await h.scope(h.owner, async (c) => ({
      document: await createDocument(c, {
        title: "Shared",
        body: "body",
        projectId: fixture.projectId,
        visibility: "workspace",
      }),
      task: await createTask(c, {
        title: "Shared",
        projectId: fixture.projectId,
      }),
    }));
    const run = await saved(fixture.runId);
    expect(run.inputs.audience.humans).toContain(h.alice.id);
    const ledger: SessionSource[] = [
      { type: "document", id: sources.document.id },
      { type: "task", id: sources.task.id },
    ];
    await expect(check(run, ledger)).resolves.toBeUndefined();
    await h.scope(h.owner, (c) =>
      deleteProjectMember(c, fixture.projectId, h.alice.id),
    );
    for (const source of ledger) {
      await expect(check(run, [source])).rejects.toMatchObject({
        code: "forbidden",
        message: "Retained source audience changed",
      });
    }
  });

  it("distinguishes an ordinary private File read from a published attachment in the accepted Chat", async () => {
    const fixture = await setup();
    const sourceFile = await file("user");
    const run = await saved(fixture.runId);
    await expect(
      check(run, [{ type: "file", id: sourceFile.id }]),
    ).rejects.toMatchObject({ code: "forbidden" });
    const message = await attach(fixture.chat.id, sourceFile.id);
    await expect(
      check(run, [
        {
          type: "attachment",
          chatId: fixture.chat.id,
          messageId: message.id,
          fileId: sourceFile.id,
        },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      check(run, [{ type: "file", id: sourceFile.id }]),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("denies an exact attachment after source Chat revocation even when another readable Chat holds the same File", async () => {
    const fixture = await setup();
    const sourceFile = await file("user");
    const accepted = await attach(fixture.chat.id, sourceFile.id);
    const otherChat = await h.scope(h.owner, async (c) => {
      const chat = await createChat(c, {
        title: "Other source",
        projectId: fixture.projectId,
        visibility: "participants",
      });
      await createParticipant(c, chat.id, {
        agentId: fixture.agent.id,
        role: "contributor",
      });
      return chat;
    });
    const other = await attach(otherChat.id, sourceFile.id);
    const run = await saved(fixture.runId);
    const source: SessionSource = {
      type: "attachment",
      chatId: fixture.chat.id,
      messageId: accepted.id,
      fileId: sourceFile.id,
    };
    await expect(check(run, [source])).resolves.toBeUndefined();
    await expect(
      check(run, [{ ...source, messageId: other.id }]),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      check(run, [{ ...source, chatId: otherChat.id, messageId: other.id }]),
    ).rejects.toMatchObject({ code: "forbidden" });
    await h.scope(h.owner, async (c) => {
      const participant = required(
        (
          await c.tx
            .select()
            .from(participants)
            .where(
              and(
                eq(participants.chatId, fixture.chat.id),
                eq(participants.agentId, fixture.agent.id),
              ),
            )
        )[0],
      );
      await deleteParticipant(c, fixture.chat.id, participant.id);
    });
    await expect(
      inWorkspace(
        h.database.db,
        h.workspaceId,
        { userId: h.owner.id, agentId: fixture.agent.id },
        (c) => isAttachedToReadableChat(c, sourceFile.id),
        false,
      ),
    ).resolves.toBe(true);
    await expect(check(run, [source])).rejects.toMatchObject({
      code: "forbidden",
      message: "Retained attachment source changed",
    });
  });

  it("uses immutable accepted Skill file provenance after current supportingFiles are cleared", async () => {
    const fixture = await skillFixture();
    const snapshot = fixture.run.inputs.skills;
    expect(snapshot[0]?.supportingFiles).toEqual([
      {
        path: fixture.source.path,
        artifactId: fixture.sourceFile.id,
        sha256: fixture.sourceFile.sha256,
        byteLength: fixture.sourceFile.byteLength,
      },
    ]);
    await expect(check(fixture.run, [fixture.source])).resolves.toBeUndefined();
    await h.scope(h.owner, (c) =>
      setSkillFiles(c, fixture.skill.id, [], fixture.skill.editToken),
    );
    expect(
      (await h.scope(h.owner, (c) => getSkill(c, fixture.skill.id)))
        .supportingFiles,
    ).toEqual([]);
    const persisted = await saved(fixture.runId);
    expect(persisted.inputs.skills).toEqual(snapshot);
    await expect(check(persisted, [fixture.source])).resolves.toBeUndefined();
  });

  it("denies Skill file references that differ from the accepted path, File, digest or byte length", async () => {
    const fixture = await skillFixture();
    for (const change of [
      { path: "references/other.txt" },
      { fileId: crypto.randomUUID() },
      { sha256: "0".repeat(64) },
      { byteLength: fixture.source.byteLength + 1 },
      { skillId: crypto.randomUUID() },
    ]) {
      await expect(
        check(fixture.run, [{ ...fixture.source, ...change }]),
      ).rejects.toMatchObject({
        code: "forbidden",
        message: "Retained Skill file is not accepted",
      });
    }
  });

  it("denies accepted Skill provenance when the stored File digest or byte length no longer matches", async () => {
    const fixture = await skillFixture();
    await expect(check(fixture.run, [fixture.source])).resolves.toBeUndefined();
    for (const change of [
      { sha256: "0".repeat(64) },
      { byteLength: fixture.source.byteLength + 1 },
    ]) {
      await h.database.db
        .update(files)
        .set({
          sha256: fixture.source.sha256,
          byteLength: fixture.source.byteLength,
          ...change,
        })
        .where(eq(files.id, fixture.source.fileId));
      await expect(check(fixture.run, [fixture.source])).rejects.toMatchObject({
        code: "conflict",
        message: "Retained Skill bytes changed",
      });
    }
  });

  it("rechecks the full audience for the accepted Skill and its File", async () => {
    const fixture = await skillFixture();
    await h.scope(h.owner, (c) =>
      updateFile(c, fixture.source.fileId, { visibility: "user" }),
    );
    await expect(check(fixture.run, [fixture.source])).rejects.toMatchObject({
      code: "forbidden",
    });
    await h.scope(h.owner, (c) =>
      updateFile(c, fixture.source.fileId, { visibility: "workspace" }),
    );
    await h.scope(h.owner, (c) =>
      updateSkill(c, fixture.skill.id, {
        visibility: "user",
        editToken: fixture.skill.editToken,
      }),
    );
    await expect(check(fixture.run, [fixture.source])).rejects.toMatchObject({
      code: "forbidden",
      message: "Retained source audience changed",
    });
  });

  it("fails closed for an unknown persisted source discriminator", async () => {
    const fixture = await setup();
    const run = await saved(fixture.runId);
    await expect(
      h.scope(h.owner, (c) =>
        Reflect.apply(authorizeRunSources, undefined, [
          c,
          run,
          [{ type: "unknown", id: crypto.randomUUID() }],
        ]),
      ),
    ).rejects.toMatchObject({
      code: "unavailable",
      message: "Unrecognized retained source",
    });
  });
});
