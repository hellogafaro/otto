import * as NodeSqlite from "node:sqlite";
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

async function fixture(
  overrides: Partial<Parameters<typeof createOrganizationAccountsRuntime>[0]> = {},
) {
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
    now: () => Date.now(),
    sendEmail: async (mail) => {
      emails.push(mail);
    },
    ...overrides,
  });

  const request = (path: string, body?: Readonly<Record<string, string>>, token?: string) =>
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

  const sendCode = async (email: string) => {
    const response = await request("/email-otp/send-verification-otp", { email, type: "sign-in" });
    expect(response.status).toBe(200);
    const mail = emails.findLast((item) => item.to === email && item.subject.endsWith("code"));

    if (!mail) throw new Error("Missing sign-in code mail");

    return mail.subject.split(" ")[0]!;
  };

  const signIn = async (email: string) => {
    const otp = await sendCode(email);
    const response = await request("/sign-in/email-otp", { email, otp });
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

  return { database, runtime, request, emails, verify, sendCode, signIn, setup };
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
    ).toBe(404);
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
            memberIdOrEmail: String(membership!.id),
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
            memberId: String(membership!.id),
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
            memberIdOrEmail: String(membership!.id),
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

describe("setup and email sign-in", () => {
  const owner = {
    organizationName: "Test organization",
    email: "owner@example.test",
    firstName: "Olga",
    lastName: "Owner",
    password,
  };

  it("sets up and signs in with the password on a server without mail", async () => {
    const { runtime, request } = await fixture({ mailConfigured: false });
    await runtime.setup(owner);

    expect(
      (await request("/email-otp/send-verification-otp", { email: owner.email, type: "sign-in" }))
        .status,
    ).toBe(404);
    expect((await request("/sign-in/email", { email: owner.email, password })).status).toBe(200);
  });

  it("sets up without mail and lets an invite link stand in for the email", async () => {
    const { runtime, request, emails } = await fixture({ mailConfigured: false });
    expect(await runtime.setup(owner)).toMatchObject({ verificationRequired: false });

    const signIn = async (email: string) => {
      const response = await request("/sign-in/email", { email, password });
      expect(response.status).toBe(200);

      return ((await response.json()) as { token: string }).token;
    };

    const admin = await signIn(owner.email);

    const invitation = await request(
      "/organization/invite-member",
      {
        email: "member@example.test",
        role: "member",
        organizationId: runtime.getOrganization()!.id,
      },
      admin,
    );

    expect(invitation.status).toBe(200);
    const { id } = (await invitation.json()) as { id: string };

    const registered = await request("/sign-up/email", {
      email: "member@example.test",
      password,
      firstName: "Mina",
      lastName: "Member",
      name: "Mina Member",
      invitationId: id,
    });

    expect(registered.status).toBe(200);
    const member = await signIn("member@example.test");
    expect(
      (await request("/organization/accept-invitation", { invitationId: id }, member)).status,
    ).toBe(200);

    expect(
      await runtime.authenticate(new Headers({ authorization: `Bearer ${member}` })),
    ).toMatchObject({ email: "member@example.test", role: "member" });
    expect(emails).toEqual([]);
  });

  it("names the https session cookie exactly as the environment session reads it", async () => {
    const httpsOrigin = "https://otto.example.test";
    const { runtime } = await fixture({ mailConfigured: false, origin: httpsOrigin });
    await runtime.setup(owner);

    const response = await runtime.handle(
      new Request(`${httpsOrigin}/api/accounts/sign-in/email`, {
        method: "POST",
        headers: { origin: httpsOrigin, "content-type": "application/json" },
        body: JSON.stringify({ email: owner.email, password }),
      }),
    );

    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.find((value) => value.startsWith("otto_test_accounts="))).toMatch(/; Secure/);
    expect(cookies.some((value) => value.startsWith("__Secure-"))).toBe(false);
  });

  it("keys sign-in rate limits on X-Forwarded-For only behind a declared proxy", async () => {
    const attempts = async (trustProxy: boolean) => {
      const { runtime } = await fixture({ mailConfigured: false, trustProxy });

      const signIn = (ip: string) =>
        runtime.handle(
          new Request(`${origin}/api/accounts/sign-in/email`, {
            method: "POST",
            headers: { origin, "content-type": "application/json", "x-forwarded-for": ip },
            body: JSON.stringify({ email: owner.email, password }),
          }),
        );

      for (let attempt = 0; attempt < 3; attempt++) await signIn("203.0.113.1");

      return (await signIn("203.0.113.2")).status;
    };

    expect(await attempts(false)).toBe(429);
    expect(await attempts(true)).not.toBe(429);
  });

  it("accepts each email code once and refuses the password while mail is set up", async () => {
    const { runtime, request, sendCode } = await fixture();
    await runtime.setup(owner);

    expect((await request("/sign-in/email", { email: owner.email, password })).status).toBe(404);
    const otp = await sendCode(owner.email);
    expect((await request("/sign-in/email-otp", { email: owner.email, otp })).status).toBe(200);

    expect(
      (await request("/sign-in/email-otp", { email: owner.email, otp })).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it("mails no code to unknown addresses and limits how often codes are sent", async () => {
    const { request, emails } = await fixture();

    const send = () =>
      request("/email-otp/send-verification-otp", {
        email: "nobody@example.test",
        type: "sign-in",
      });

    for (let attempt = 0; attempt < 3; attempt += 1) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    expect(emails).toHaveLength(0);
  });
});
