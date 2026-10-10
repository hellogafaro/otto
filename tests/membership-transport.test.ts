import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { createSmtpMail } from "../apps/server/src/mail";
import { startQueue } from "../apps/server/src/queue";
import { createCursorCodec } from "../packages/db/src";
import { openNativeStorage } from "../packages/sessions/src/native";
import { claimInstallation } from "../packages/workspaces/src";
import { invitations, users } from "../packages/workspaces/src/schema";
import { startSmtp } from "./fixtures/smtp";
import { startPostgres } from "./postgres";

it("delivers committed private tokens through HTTP, authorizes unverified recipients and guards human ownership on role changes", async () => {
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
  app = createApp({
    nativeStorage,
    db: database.db,
    boss,
    auth,
    origin,
    mail,
    cursors: createCursorCodec(crypto.randomUUID() + crypto.randomUUID()),
  });
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
    const login = await post("/auth/sign-in/email", { email, password });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    if (!session) throw new Error("Missing session");
    expect(session.user.emailVerified).toBe(false);
    return { cookie, id: session.user.id, email };
  };
  const record = z.object({ id: z.uuid() });
  const mailedToken = (id: string) => {
    const token = received
      .findLast(
        (message) =>
          message.subject === "Your Otto invitation" &&
          message.text.includes(`Invitation ID: ${id}`),
      )
      ?.text.match(/Invitation token: (\S+)/)?.[1];
    if (!token) throw new Error("Missing invitation token");
    return token;
  };
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
    const created = await (
      await post(
        `${path}/invitations`,
        { email: human.email, role: "contributor" },
        owner.cookie,
      )
    ).json();
    const invitation = z
      .object({ id: z.uuid(), delivery: z.literal("uncertain") })
      .parse(created);
    expect(created).not.toHaveProperty("token");
    expect(JSON.stringify(created)).not.toContain(mailedToken(invitation.id));
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
    const token = mailedToken(invitation.id);
    expect(
      (
        await post(
          `${path}/invitations/${invitation.id}/send`,
          {},
          human.cookie,
        )
      ).status,
    ).toBe(403);
    for (const body of [
      {},
      { id: invitation.id },
      { token: "" },
      { token, email: human.email },
    ])
      expect(
        (await post(`/invitations/${invitation.id}/accept`, body, human.cookie))
          .status,
      ).toBe(400);
    for (const invalid of [invitation.id, `${token.slice(0, -1)}!`])
      expect(
        (
          await post(
            `/invitations/${invitation.id}/accept`,
            { token: invalid },
            human.cookie,
          )
        ).status,
      ).toBe(403);
    expect(
      (
        await post(
          `/invitations/${invitation.id}/accept`,
          { token },
          owner.cookie,
        )
      ).status,
    ).toBe(403);
    const accepted = await Promise.all([
      post(`/invitations/${invitation.id}/accept`, { token }, human.cookie),
      post(`/invitations/${invitation.id}/accept`, { token }, human.cookie),
    ]);
    expect(accepted.map((response) => response.status).sort()).toEqual([
      200, 403,
    ]);
    expect(
      (
        await post(
          `/invitations/${invitation.id}/accept`,
          { token },
          human.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await database.db.select().from(users).where(eq(users.id, human.id)))[0]
        ?.emailVerified,
    ).toBe(false);
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
          { email: human.email, role: "viewer" },
          owner.cookie,
        )
      ).json(),
    );
    const revokedToken = mailedToken(revoked.id);
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
      (
        await post(
          `/invitations/${revoked.id}/accept`,
          { token: revokedToken },
          human.cookie,
        )
      ).status,
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
