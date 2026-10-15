import * as NodeSqlite from "node:sqlite";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  createOrganizationAccountsRuntime,
  type AccountMail,
} from "./organization-accounts-runtime.ts";

const databases: NodeSqlite.DatabaseSync[] = [];

const origin = "http://localhost:43210";

const password = "Test-only account password 42";

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function fixture() {
  const database = new NodeSqlite.DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  const emails: AccountMail[] = [];

  const runtime = await createOrganizationAccountsRuntime({
    database,
    secret: "isolated-test-auth-secret-not-for-any-real-installation",
    origin,
    cookieName: "otto_test_accounts",
    mailConfigured: true,
    now: () => Effect.runSync(Clock.currentTimeMillis),
    sendEmail: async (mail) => {
      emails.push(mail);
    },
  });

  const request = (path: string, body?: Record<string, unknown>, token?: string) =>
    runtime.handle(
      new Request(`${origin}/api/accounts${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin,
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );

  const verify = async (email: string) => {
    const mail = emails.findLast(
      (item) => item.to === email && item.subject === "Verify your Otto email",
    );

    const url = mail?.text.split("\n").find((line) => line.startsWith(origin));

    if (!url) throw new Error("Missing verification mail");

    const response = await runtime.handle(new Request(url));
    expect(response.status).toBeLessThan(400);
  };

  const signIn = async (email: string) => {
    const response = await request("/sign-in/email", { email, password });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string; user: { id: string } };

    return body;
  };

  const setup = async () => {
    await runtime.setup({
      organizationName: "Test organization",
      email: "admin@example.test",
      firstName: "Ada",
      lastName: "Admin",
      password,
    });
    await verify("admin@example.test");

    return signIn("admin@example.test");
  };

  return { database, runtime, request, emails, verify, signIn, setup };
}

describe("installation accounts", () => {
  it("lets the first visitor create the one organization with a named admin", async () => {
    const { runtime, request, setup } = await fixture();
    expect(runtime.getOrganization()).toBeNull();

    const admin = await setup();

    const principal = await runtime.authenticate(
      new Headers({ authorization: `Bearer ${admin.token}` }),
    );

    expect(principal).toMatchObject({ firstName: "Ada", lastName: "Admin", role: "admin" });
    expect(runtime.getOrganization()?.name).toBe("Test organization");
    await expect(
      runtime.setup({
        organizationName: "Other",
        firstName: "Other",
        lastName: "Admin",
        email: "other@example.test",
        password,
      }),
    ).rejects.toThrow("already set up");
    expect(
      (await request("/organization/create", { name: "Other", slug: "other" }, admin.token)).status,
    ).toBe(404);
  });

  it("rejects public registration without creating a user", async () => {
    const { database, request } = await fixture();

    const response = await request("/sign-up/email", {
      email: "uninvited@example.test",
      password,
      firstName: "No",
      lastName: "Invite",
      name: "No Invite",
    });

    expect(response.status).toBe(403);
    expect(database.prepare("SELECT count(*) AS count FROM users").get()?.count).toBe(0);
  });

  it("accepts verified invitations and revokes existing account access when removed", async () => {
    const { runtime, request, emails, verify, signIn, setup, database } = await fixture();
    const admin = await setup();
    const organizationId = runtime.getOrganization()!.id;

    const invitationResponse = await request(
      "/organization/invite-member",
      {
        email: "member@example.test",
        role: "member",
        organizationId,
      },
      admin.token,
    );

    expect(invitationResponse.status).toBe(200);
    expect(
      emails.some((mail) => mail.to === "member@example.test" && mail.subject.startsWith("Join")),
    ).toBe(true);
    const invitation = (await invitationResponse.json()) as { id: string };

    const registered = await request("/sign-up/email", {
      email: "member@example.test",
      password,
      firstName: "Mina",
      lastName: "Member",
      name: "Mina Member",
      invitationId: invitation.id,
      callbackURL: `${origin}/login`,
    });

    expect(registered.status).toBe(200);
    expect(
      (await request("/sign-in/email", { email: "member@example.test", password })).status,
    ).toBe(403);
    await verify("member@example.test");
    const member = await signIn("member@example.test");
    expect(
      await runtime.authenticate(new Headers({ authorization: `Bearer ${member.token}` })),
    ).toBeNull();
    expect(
      (
        await request(
          "/organization/accept-invitation",
          { invitationId: invitation.id },
          member.token,
        )
      ).status,
    ).toBe(200);

    const principal = await runtime.authenticate(
      new Headers({ authorization: `Bearer ${member.token}` }),
    );

    expect(principal?.role).toBe("member");
    expect(
      (
        await request(
          "/organization/invite-member",
          {
            email: "another@example.test",
            role: "admin",
            organizationId,
          },
          member.token,
        )
      ).status,
    ).toBe(403);

    const membership = database
      .prepare("SELECT id FROM members WHERE userId = ?")
      .get(member.user.id);

    expect(
      (
        await request(
          "/organization/remove-member",
          {
            memberIdOrEmail: membership!.id,
            organizationId,
          },
          admin.token,
        )
      ).status,
    ).toBe(200);
    expect(runtime.getPrincipal(principal!.sessionId)).toBeNull();
    expect(
      await runtime.authenticate(new Headers({ authorization: `Bearer ${member.token}` })),
    ).toBeNull();
  });

  it("protects the last admin at both the API and database boundaries", async () => {
    const { setup, runtime, database, request } = await fixture();
    const admin = await setup();
    const organizationId = runtime.getOrganization()!.id;

    const membership = database
      .prepare("SELECT id FROM members WHERE userId = ?")
      .get(admin.user.id);

    expect(
      (
        await request(
          "/organization/update-member-role",
          {
            memberId: membership!.id,
            role: "member",
            organizationId,
          },
          admin.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "/organization/remove-member",
          {
            memberIdOrEmail: membership!.id,
            organizationId,
          },
          admin.token,
        )
      ).status,
    ).toBe(400);
    expect(() =>
      database.prepare("DELETE FROM members WHERE id = ?").run(membership!.id!),
    ).toThrow();
    expect(() =>
      database.prepare("UPDATE members SET role = 'owner' WHERE id = ?").run(membership!.id!),
    ).toThrow();
  });
});
