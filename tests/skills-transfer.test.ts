import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { upsertShare } from "../apps/server/src/content-shares";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import { createChat, createParticipant } from "../packages/chats/src";
import {
  createCollection,
  createDocument,
  getDocument,
  updateDocumentCollection,
} from "../packages/documents/src";
import { createEnvironment } from "../packages/environments/src";
import { createProject } from "../packages/projects/src";
import { admitRun, dispatchRun } from "../packages/runs/src";
import { runs } from "../packages/runs/src/schema";
import { openNativeStorage } from "../packages/sessions/src/native";
import {
  createSkill,
  exportSkill,
  getSkill,
  getSkillProposals,
  proposeSkillChange,
  resolveSkillProposal,
} from "../packages/skills/src";
import {
  createTask,
  createTaskLink,
  deleteTaskLink,
  getTaskLinks,
} from "../packages/tasks/src";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { users } from "../packages/workspaces/src/schema";
import { pushDatabase } from "../scripts/push";
import {
  controlledSubscription,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { startPostgres } from "./postgres";

it("explicit offline transfer preserves skill IDs, accepted Run/Session bytes and proposals; mixed Document links refuse atomically", async () => {
  const database = await startPostgres();
  const nativeStorage = await openNativeStorage({
    connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
  });
  const boss = await startQueue(database.db, database.pool, {
    workers: false,
    install: true,
  });
  try {
    await database.db.insert(users).values({
      id: "transfer-owner",
      name: "Owner",
      email: "transfer@example.test",
      emailVerified: true,
    });
    const workspaceId = (
      await claimInstallation(database.db, "transfer-owner", "Transfer")
    ).id;
    const scope = <T>(work: Parameters<typeof inWorkspace<T>>[3]) =>
      inWorkspace(database.db, workspaceId, { userId: "transfer-owner" }, work);
    const skill = await scope((c) =>
      createSkill(c, {
        title: "retained-skill",
        whenToUse: "Test",
        instructions: "Exact accepted instructions",
        visibility: "workspace",
      }),
    );
    const doc = await scope((c) =>
      createDocument(c, {
        title: "Ordinary",
        body: "Ordinary document",
        visibility: "workspace",
      }),
    );
    const proposal = await scope((c) =>
      proposeSkillChange(c, skill.id, {
        title: skill.title,
        instructions: "Proposed",
        editToken: 0,
      }),
    );
    const agent = await scope(async (c) =>
      createAgent(c, {
        title: "Worker",
        instructions: "Work",
        model: "selected",
        skillIds: [skill.id],
        subscriptionId: await controlledSubscription(c),
        visibility: "workspace",
      }),
    );
    await scope((c) => createEnvironment(c, agent.id));
    const chat = await scope((c) =>
      createChat(c, { title: "Output", visibility: "workspace" }),
    );
    await scope((c) =>
      createParticipant(c, chat.id, {
        agentId: agent.id,
        role: "contributor",
      }),
    );
    const request = {
      chatId: chat.id,
      agentId: agent.id,
      requestId: crypto.randomUUID(),
      type: "prompt" as const,
      body: "Work",
    };
    const run = await scope((c) =>
      admitRun(c, boss, request, nativeModelAuthorization),
    );
    await dispatchRun(database.db, run.id);
    const privateScope = JSON.stringify({
      sources: {
        documentIds: [doc.id],
        skills: [{ documentId: skill.id, files: [] }],
      },
    });
    await database.pool.query(
      'update environments set "executionScope"=$1 where "agentId"=$2',
      [privateScope, agent.id],
    );
    const evidence = async () => ({
      runs: (
        await database.pool.query(
          'select inputs::text,"requestIdentity"::text from runs where id=$1',
          [run.id],
        )
      ).rows,
      sessions: (
        await database.pool.query(
          'select row_to_json(s)::text from agent_sessions s where "agentId"=$1',
          [agent.id],
        )
      ).rows,
      scope: (
        await database.pool.query(
          'select "executionScope" from environments where "agentId"=$1',
          [agent.id],
        )
      ).rows,
    });
    const before = await evidence();
    // Reconstruct only the captured pre-split storage shape on this disposable DB.
    await database.pool.query(`
      alter table documents add column skill boolean not null default false, add column "skillMetadata" jsonb not null default '{}', add column "whenToUse" text, add column "supportingFiles" jsonb not null default '[]';
      insert into documents(id,"workspaceId","createdAt","updatedAt",archived,"projectId",title,body,"createdBy",visibility,"editToken",skill,"skillMetadata","whenToUse","supportingFiles")
        select id,"workspaceId","createdAt","updatedAt",archived,"projectId",title,instructions,"createdBy",visibility,"editToken",true,metadata,"whenToUse","supportingFiles" from skills;
      insert into document_proposals(id,"documentId","proposerId","agentId",title,body,"editToken") select id,"skillId","proposerId","agentId",title,instructions,"editToken" from skill_proposals;
      alter table agents_skills drop constraint agents_skills_skill_workspace_fk;
      alter table agents_skills rename constraint agents_skills_agent_workspace_fk to agent_skills_agent_workspace_fk;
      alter table agents_skills rename constraint "agents_skills_agentId_skillId_pk" to "agent_skills_agentId_skillId_pk";
      alter table agents_skills rename to agent_skills;
      alter table agent_skills add constraint agent_skills_document_workspace_fk foreign key("skillId","workspaceId") references documents(id,"workspaceId");
      drop table skill_proposals; drop table skills;
    `);
    // A mixed ordinary Document link cannot be silently reinterpreted as a Skill.
    const fieldId = crypto.randomUUID();
    const collection = await scope((c) =>
      createCollection(c, {
        title: "Typed references",
        fields: [{ id: fieldId, title: "Document", type: "document" }],
      }),
    );
    const linkedDoc = await scope((c) =>
      updateDocumentCollection(c, doc.id, {
        collectionId: collection.id,
        properties: { [fieldId]: skill.id.toUpperCase() },
        editToken: 0,
      }),
    );
    expect(linkedDoc.properties[fieldId]).toBe(skill.id.toUpperCase());
    const sql = await Bun.file(
      new URL("../scripts/transfer-skills.sql", import.meta.url),
    ).text();
    // The Skills script belongs to the Resources-era sequence: it sees the Resources attachment column name.
    const transfer = async (client: {
      query: (q: string) => Promise<unknown>;
    }) => {
      await client.query(
        'alter table documents rename column "fileIds" to "resourceIds"',
      );
      try {
        return await client.query(sql);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        await client.query(
          'alter table documents rename column "resourceIds" to "fileIds"',
        );
      }
    };
    const client = await database.pool.connect();
    try {
      await expect(transfer(client)).rejects.toThrow(
        "Skill also referenced as ordinary Document",
      );
      await client.query("rollback");
      expect(
        (await client.query("select to_regclass('skills') as table")).rows[0]
          ?.table,
      ).toBeNull();
      expect(
        (
          await client.query(
            "select count(*)::int as count from documents where skill",
          )
        ).rows[0]?.count,
      ).toBe(1);
      expect(await scope((c) => getDocument(c, doc.id))).toEqual(linkedDoc);
      expect(
        (
          await scope((c) =>
            getDocument(c, String(linkedDoc.properties[fieldId])),
          )
        ).id,
      ).toBe(skill.id);
      expect(await evidence()).toEqual(before);
      await scope((c) =>
        updateDocumentCollection(c, doc.id, {
          collectionId: collection.id,
          properties: {},
          editToken: linkedDoc.editToken,
        }),
      );
      // Other persisted ordinary references use the same UUID semantics, not text casing.
      const share = await scope((c) =>
        upsertShare(
          c,
          {
            type: "document",
            targetId: skill.id.toUpperCase(),
            start: 0,
            end: 1,
          },
          undefined,
          nativeStorage,
        ),
      );
      const shareBefore = (
        await client.query("select row_to_json(s)::text from content_shares s")
      ).rows;
      await expect(transfer(client)).rejects.toThrow(
        "Skill also referenced as ordinary Document",
      );
      await client.query("rollback");
      expect(
        (
          await client.query(
            "select row_to_json(s)::text from content_shares s",
          )
        ).rows,
      ).toEqual(shareBefore);
      await client.query("delete from content_shares where id=$1", [share.id]);
      const originalInputs = (
        await client.query("select inputs::text from runs where id=$1", [
          run.id,
        ])
      ).rows[0]?.inputs;
      await client.query(
        `update runs set inputs=jsonb_set(inputs,'{context}',
          jsonb_build_object('documents',jsonb_build_array(jsonb_build_object('id',$2::text)))) where id=$1`,
        [run.id, skill.id.toUpperCase()],
      );
      const contextBefore = await evidence();
      await expect(transfer(client)).rejects.toThrow(
        "Skill also referenced as ordinary Document",
      );
      await client.query("rollback");
      expect(await evidence()).toEqual(contextBefore);
      await client.query("update runs set inputs=$1::jsonb where id=$2", [
        originalInputs,
        run.id,
      ]);
      await client.query(
        'update environments set "executionScope"=$1 where "agentId"=$2',
        [
          JSON.stringify({
            sources: { documentIds: [skill.id.toUpperCase()] },
          }),
          agent.id,
        ],
      );
      const retainedBefore = await evidence();
      await expect(transfer(client)).rejects.toThrow(
        "Skill also referenced as ordinary Document",
      );
      await client.query("rollback");
      expect(await evidence()).toEqual(retainedBefore);
      await client.query(
        'update environments set "executionScope"=$1 where "agentId"=$2',
        [privateScope, agent.id],
      );
      expect(await evidence()).toEqual(before);
      const project = await scope((c) =>
        createProject(c, { title: "Linked documents" }),
      );
      const task = await scope((c) =>
        createTask(c, { projectId: project.id, title: "Preserve links" }),
      );
      // Same target authorization and link-domain calls as the production transport.
      for (const reference of [doc.id, skill.id.toUpperCase()])
        await scope(async (c) => {
          await getDocument(c, reference);
          await createTaskLink(c, task.id, { type: "document", reference });
        });
      const linksBefore = await scope((c) => getTaskLinks(c, task.id));
      expect(linksBefore.items).toHaveLength(2);
      const documentsBefore = (
        await client.query(
          "select row_to_json(d)::text from documents d order by id",
        )
      ).rows;
      await expect(transfer(client)).rejects.toThrow(
        "Skill also referenced as ordinary Document",
      );
      await client.query("rollback");
      expect(
        (await client.query("select to_regclass('skills') as table")).rows[0]
          ?.table,
      ).toBeNull();
      expect(
        (
          await client.query(
            "select row_to_json(d)::text from documents d order by id",
          )
        ).rows,
      ).toEqual(documentsBefore);
      expect(await scope((c) => getTaskLinks(c, task.id))).toEqual(linksBefore);
      for (const link of linksBefore.items) {
        expect(link.type).toBe("document");
        expect((await scope((c) => getDocument(c, link.reference))).id).toBe(
          link.reference.toLowerCase(),
        );
      }
      expect(await evidence()).toEqual(before);
      // Only explicit operator disposition removes the ambiguous link; ordinary links remain.
      const ambiguous = linksBefore.items.find(
        (link) => link.reference === skill.id.toUpperCase(),
      );
      if (!ambiguous) throw new Error("Missing linked legacy Skill");
      await scope((c) => deleteTaskLink(c, task.id, ambiguous.id));
      const ordinaryLinks = await scope((c) => getTaskLinks(c, task.id));
      await transfer(client);
      expect(await scope((c) => getTaskLinks(c, task.id))).toEqual(
        ordinaryLinks,
      );
      expect(
        (
          await scope((c) =>
            getDocument(c, ordinaryLinks.items[0]?.reference ?? ""),
          )
        ).body,
      ).toBe(doc.body);
    } finally {
      client.release();
    }
    expect(await evidence()).toEqual(before);
    expect((await scope((c) => getSkill(c, skill.id))).instructions).toBe(
      skill.instructions,
    );
    expect((await scope((c) => getDocument(c, doc.id))).body).toBe(doc.body);
    await expect(scope((c) => getDocument(c, skill.id))).rejects.toMatchObject({
      code: "not_found",
    });
    expect(
      (await scope((c) => getSkillProposals(c, skill.id))).items[0]?.id,
    ).toBe(proposal.id);
    expect(
      (await scope((c) => admitRun(c, boss, request, nativeModelAuthorization)))
        .id,
    ).toBe(run.id);
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
        ?.inputs.skills[0]?.documentId,
    ).toBe(skill.id);
    const url = `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`;
    await pushDatabase(url);
    await pushDatabase(url);
    expect(await evidence()).toEqual(before);
    await scope((c) => resolveSkillProposal(c, skill.id, proposal.id, true));
    expect((await scope((c) => exportSkill(c, skill.id))).skillMd).toContain(
      "Proposed",
    );
  } finally {
    await boss.stop();
    await nativeStorage.close();
    await database.stop();
  }
});
