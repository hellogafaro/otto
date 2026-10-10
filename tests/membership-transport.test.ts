import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { createSmtpMail } from "../apps/server/src/mail";
import { startQueue } from "../apps/server/src/queue";
import { openNativeStorage } from "../packages/sessions/src/native";
import { claimInstallation } from "../packages/workspaces/src";
import { invitations } from "../packages/workspaces/src/schema";
import { startSmtp } from "./fixtures/smtp";
import { startPostgres } from "./postgres";

it("delivers committed invitations through HTTP, verifies recipients and guards human ownership on role changes", async () => {
  const database = await startPostgres();
  const nativeStorage = await openNativeStorage({
    connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
  });
  const boss = await startQueue(database.db, database.pool, {
    workers: false,
    install: true,
  });
  let rejectMail = false;
  const sink = await startSmtp({
    async onData(message) {
      if (message.subject === "Your Otto invitation") {
        const invitationId = message.text.match(
          /Invitation ID: ([a-f0-9-]+)/,
        )?.[1];
        if (!invitationId) throw new Error("Missing invitation ID");
        // Separate database connection must already see the committed invitation.
        expect(
          (
            await database.db
              .select()
              .from(invitations)
              .where(eq(invitations.id, invitationId))
          )[0]?.email,
        ).toBe(message.to[0]);
      }
      if (rejectMail) return new Error("private provider detail");
    },
  });
  const received = sink.messages;
  const mail = createSmtpMail({
    from: "otto@example.test",
    host: sink.host,
    port: sink.port,
    tls: "none",
  });
  let app: ReturnType<typeof createApp>;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => app.fetch(request),
  });
  const origin = server.url.origin;
  const auth = createAuth(
    database.db,
    crypto.randomUUID() + crypto.randomUUID(),
    origin,
    mail,
  );
  app = createApp({ nativeStorage, db: database.db, boss, auth, origin, mail });
  const post = (path: string, body: unknown, cookie = "") =>
    fetch(`${origin}/api${path}`, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const createUser = async (email: string) => {
    const password = crypto.randomUUID() + crypto.randomUUID();
    expect(
      (await post("/auth/sign-up/email", { email, password, name: email }))
        .status,
    ).toBe(200);
    const message = received.find(
      (m) => m.to[0] === email && m.subject === "Verify your Otto email",
    );
    const url = message?.text.split("Verify your email: ")[1];
    if (!url) throw new Error("Verification missing");
    expect((await fetch(url, { redirect: "manual" })).status).toBe(302);
    const login = await post("/auth/sign-in/email", { email, password });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    if (!session) throw new Error("Missing session");
    return { cookie, id: session.user.id, email };
  };
  const record = z.object({ id: z.uuid() });
  try {
    const owner = await createUser("owner@membership.test");
    const human = await createUser("human@membership.test");
    const workspace = await claimInstallation(
      database.db,
      owner.id,
      "Membership",
    );
    const path = `/workspaces/${workspace.id}`;
    rejectMail = true;
    const invitation = z
      .object({ id: z.uuid(), delivery: z.literal("uncertain") })
      .parse(
        await (
          await post(
            `${path}/invitations`,
            { email: human.email, role: "contributor" },
            owner.cookie,
          )
        ).json(),
      );
    rejectMail = false;
    expect(
      await (
        await post(
          `${path}/invitations/${invitation.id}/send`,
          { email: "wrong@example.test" },
          owner.cookie,
        )
      ).json(),
    ).toEqual({ delivery: "sent" });
    expect(received.at(-1)?.to).toEqual([human.email]);
    expect(
      (
        await post(
          `${path}/invitations/${invitation.id}/send`,
          {},
          human.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await post(`/invitations/${invitation.id}/accept`, {}, human.cookie))
        .status,
    ).toBe(200);
    expect(
      (await post(`/invitations/${invitation.id}/accept`, {}, human.cookie))
        .status,
    ).toBe(403);
    expect(
      (
        await post(
          `${path}/invitations/${invitation.id}/send`,
          {},
          owner.cookie,
        )
      ).status,
    ).toBe(409);
    const revoked = record.parse(
      await (
        await post(
          `${path}/invitations`,
          { email: "unused@membership.test", role: "viewer" },
          owner.cookie,
        )
      ).json(),
    );
    const update = (id: string, body: unknown, cookie = owner.cookie) =>
      fetch(`${origin}/api${path}/invitations/${id}`, {
        method: "PATCH",
        headers: { origin, cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await update(revoked.id, { status: "accepted" })).status).toBe(400);
    expect(
      (
        await update(revoked.id, {
          status: "revoked",
          email: "replacement@example.test",
        })
      ).status,
    ).toBe(400);
    expect(
      (await update(revoked.id, { status: "revoked" }, human.cookie)).status,
    ).toBe(403);
    expect((await update(invitation.id, { status: "revoked" })).status).toBe(
      409,
    );
    expect(
      (
        await fetch(`${origin}/api${path}/invitations/${revoked.id}`, {
          method: "PATCH",
          headers: {
            cookie: owner.cookie,
            origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({ status: "revoked" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (await post(`${path}/invitations/${revoked.id}/send`, {}, owner.cookie))
        .status,
    ).toBe(409);

    expect((await update(revoked.id, { status: "revoked" })).status).toBe(409);
    expect(
      (await post(`/invitations/${revoked.id}/accept`, {}, human.cookie))
        .status,
    ).toBe(403);
    const project = record.parse(
      await (
        await post(`${path}/projects`, { title: "Owned work" }, owner.cookie)
      ).json(),
    );
    expect(
      (
        await post(
          `${path}/projects/${project.id}/members`,
          { userId: human.id, role: "contributor" },
          owner.cookie,
        )
      ).status,
    ).toBe(200);
    const task = record.parse(
      await (
        await post(
          `${path}/tasks`,
          {
            projectId: project.id,
            title: "Keep eligible owner",
            ownerId: human.id,
          },
          owner.cookie,
        )
      ).json(),
    );
    const demote = () =>
      post(
        `${path}/members/${human.id}/role`,
        { role: "viewer" },
        owner.cookie,
      );
    const remove = () =>
      fetch(`${origin}/api${path}/members/${human.id}`, {
        method: "DELETE",
        headers: { origin, cookie: owner.cookie },
      });
    expect((await demote()).status).toBe(409);
    expect((await remove()).status).toBe(409);
    expect(
      (
        await fetch(`${origin}/api${path}/tasks/${task.id}`, {
          method: "PATCH",
          headers: {
            origin,
            cookie: owner.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ownerId: owner.id, editToken: 0 }),
        })
      ).status,
    ).toBe(200);
    const agent = z.object({ agent: record }).parse(
      await (
        await post(
          `${path}/agents`,
          {
            title: "Agent",
            instructions: "Work",
            model: "fixture",
          },
          human.cookie,
        )
      ).json(),
    ).agent;
    const chat = record.parse(
      await (
        await post(
          `${path}/chats`,
          { title: "Schedule", visibility: "workspace" },
          human.cookie,
        )
      ).json(),
    );
    const schedule = record.parse(
      await (
        await post(
          `${path}/schedules`,
          {
            title: "Owned schedule",
            agentId: agent.id,
            chatId: chat.id,
            type: "script",
            body: "true",
          },
          human.cookie,
        )
      ).json(),
    );
    expect((await demote()).status).toBe(409);
    expect((await remove()).status).toBe(409);
    expect(
      (
        await fetch(`${origin}/api${path}/schedules/${schedule.id}`, {
          method: "PATCH",
          headers: {
            origin,
            cookie: human.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ownerId: owner.id, editToken: 0 }),
        })
      ).status,
    ).toBe(200);
    expect((await demote()).status).toBe(200);
    const directory = z
      .object({
        items: z.array(z.object({ userId: z.string(), role: z.string() })),
      })
      .parse(
        await (
          await fetch(`${origin}/api${path}/members`, {
            headers: { cookie: human.cookie },
          })
        ).json(),
      );
    expect(directory.items.find((m) => m.userId === human.id)?.role).toBe(
      "viewer",
    );
    expect((await remove()).status).toBe(200);
    expect(
      (
        await fetch(`${origin}/api${path}/members`, {
          headers: { cookie: human.cookie },
        })
      ).status,
    ).toBe(403);
  } finally {
    await server.stop(true);
    try {
      await sink.close();
    } finally {
      await boss.stop();
      await nativeStorage.close();
      await database.stop();
    }
  }
});
