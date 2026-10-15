import { runWithTransaction } from "@better-auth/core/context";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { bearer, organization } from "better-auth/plugins";
import { adminAc, memberAc } from "better-auth/plugins/organization/access";
import * as NodeSqlite from "node:sqlite";
import * as DateTime from "effect/DateTime";
import { z } from "zod";

const personName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\r\n\u0000]+$/u);

export const OrganizationSetupInput = z
  .object({
    organizationName: personName,
    firstName: personName,
    lastName: personName,
    email: z
      .email()
      .max(254)
      .transform((email) => email.toLowerCase()),
    password: z.string().min(8).max(128),
  })
  .strict();

const organizationRow = z.object({ id: z.string(), name: z.string() });

const principalRow = z.object({
  sessionId: z.string(),
  userId: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  organizationId: z.string(),
  role: z.enum(["admin", "member"]),
  expiresAt: z.iso.datetime().transform((value) => Date.parse(value)),
});

export type AccountPrincipal = z.infer<typeof principalRow>;

const personRow = z.object({
  userId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
});

export interface AccountPerson {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
}

export interface AccountMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export async function createOrganizationAccountsRuntime(options: {
  readonly database: NodeSqlite.DatabaseSync;
  readonly secret: string;
  readonly origin: string;
  readonly cookieName: string;
  readonly mailConfigured: boolean;
  readonly now: () => number;
  readonly sendEmail: (mail: AccountMail) => Promise<void>;
}) {
  const database = options.database;
  const origin = new URL(options.origin).origin;

  const requireMail = () => {
    if (!options.mailConfigured) {
      throw new APIError("SERVICE_UNAVAILABLE", {
        code: "EMAIL_NOT_CONFIGURED",
        message: "Configure organization email before creating accounts or sending invitations.",
      });
    }
  };

  const preserveLastAdmin = (member: { id: string; role: string }) => {
    if (member.role !== "admin") return;

    const otherAdmin = database
      .prepare("SELECT id FROM members WHERE role = 'admin' AND id <> ? LIMIT 1")
      .get(member.id);

    if (!otherAdmin) {
      throw new APIError("BAD_REQUEST", {
        code: "LAST_ADMIN",
        message: "Keep at least one organization admin.",
      });
    }
  };

  const authOptions = {
    appName: "Otto",
    baseURL: origin,
    basePath: "/api/accounts",
    database,
    secret: options.secret,
    trustedOrigins: [origin],
    user: {
      modelName: "users",
      additionalFields: {
        firstName: { type: "string", required: true, validator: { input: personName } },
        lastName: { type: "string", required: true, validator: { input: personName } },
      },
    },
    session: {
      modelName: "user_sessions",
      expiresIn: 60 * 60 * 24 * 30,
      cookieCache: { enabled: false },
    },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        requireMail();
        await options.sendEmail({
          to: user.email,
          subject: "Reset your Otto password",
          text: `Reset your password using this link:\n\n${url}\n\nIf you did not request this, ignore this email.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: async ({ user, url }) => {
        requireMail();
        await options.sendEmail({
          to: user.email,
          subject: "Verify your Otto email",
          text: `Verify your email to sign in to Otto:\n\n${url}`,
        });
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      storage: "database",
      modelName: "account_rate_limits",
    },
    advanced: {
      database: { joins: true },
      cookies: { session_token: { name: options.cookieName } },
      useSecureCookies: origin.startsWith("https:"),
    },
    plugins: [
      bearer(),
      organization({
        allowUserToCreateOrganization: false,
        creatorRole: "admin",
        roles: { admin: adminAc, member: memberAc },
        disableOrganizationDeletion: true,
        requireEmailVerificationOnInvitation: true,
        schema: {
          organization: { modelName: "organizations" },
          member: { modelName: "members" },
          invitation: { modelName: "invitations" },
        },
        sendInvitationEmail: async ({ id, email, organization }) => {
          requireMail();
          const url = new URL(`/invite/${encodeURIComponent(id)}`, origin);
          await options.sendEmail({
            to: email,
            subject: `Join ${organization.name} on Otto`,
            text: `You have been invited to ${organization.name}. Sign in or create an account to accept:\n\n${url}`,
          });
        },
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation }) => {
            requireMail();

            if (invitation.role !== "admin" && invitation.role !== "member") {
              throw new APIError("BAD_REQUEST", { message: "Choose admin or member." });
            }
          },
          beforeUpdateMemberRole: async ({ member, newRole }) => {
            if (newRole !== "admin" && newRole !== "member") {
              throw new APIError("BAD_REQUEST", { message: "Choose admin or member." });
            }

            if (newRole !== "admin") preserveLastAdmin(member);
          },
          beforeRemoveMember: async ({ member }) => preserveLastAdmin(member),
        },
      }),
    ],
  } satisfies BetterAuthOptions;

  const migrations = await getMigrations(authOptions);
  await migrations.runMigrations();
  const auth = betterAuth(authOptions);
  await (await auth.$context).checkSchema?.();

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS organization_singleton ON organizations ((1));
    CREATE TRIGGER IF NOT EXISTS organization_member_role_insert
    BEFORE INSERT ON members WHEN NEW.role NOT IN ('admin', 'member')
    BEGIN SELECT RAISE(ABORT, 'Invalid organization role'); END;
    CREATE TRIGGER IF NOT EXISTS organization_member_role_update
    BEFORE UPDATE OF role ON members WHEN NEW.role NOT IN ('admin', 'member')
    BEGIN SELECT RAISE(ABORT, 'Invalid organization role'); END;
    CREATE TRIGGER IF NOT EXISTS organization_last_admin_delete
    BEFORE DELETE ON members
    WHEN OLD.role = 'admin' AND NOT EXISTS (
      SELECT 1 FROM members WHERE role = 'admin' AND id <> OLD.id
    )
    BEGIN SELECT RAISE(ABORT, 'Keep at least one organization admin'); END;
    CREATE TRIGGER IF NOT EXISTS organization_last_admin_update
    BEFORE UPDATE OF role, organizationId ON members
    WHEN OLD.role = 'admin' AND (NEW.role <> 'admin' OR NEW.organizationId <> OLD.organizationId)
      AND NOT EXISTS (SELECT 1 FROM members WHERE role = 'admin' AND id <> OLD.id)
    BEGIN SELECT RAISE(ABORT, 'Keep at least one organization admin'); END;
    CREATE TRIGGER IF NOT EXISTS organization_member_sessions_delete
    AFTER DELETE ON members
    BEGIN DELETE FROM user_sessions WHERE userId = OLD.userId; END;
  `);

  const selectOrganization = database.prepare("SELECT id, name FROM organizations LIMIT 1");

  const selectPrincipal = database.prepare(`
    SELECT s.id AS sessionId, s.userId, u.email, u.firstName, u.lastName,
      m.organizationId AS organizationId, m.role, s.expiresAt
    FROM user_sessions s
    JOIN users u ON u.id = s.userId
    JOIN members m ON m.userId = u.id
    JOIN organizations w ON w.id = m.organizationId
    WHERE s.id = ? AND s.expiresAt > ? AND u.emailVerified = 1
  `);

  const getOrganization = () => {
    const row = selectOrganization.get();

    return row ? organizationRow.parse(row) : null;
  };

  const selectPeople = database.prepare(`
    SELECT u.id AS userId, u.firstName, u.lastName, u.email
    FROM members m
    JOIN users u ON u.id = m.userId
    WHERE u.emailVerified = 1
    ORDER BY u.firstName, u.lastName
  `);

  /** Everyone in the organization who can sign in, for group membership. */
  const listPeople = (): ReadonlyArray<AccountPerson> =>
    selectPeople.all().map((row) => {
      const person = personRow.parse(row);

      return {
        userId: person.userId,
        displayName: `${person.firstName} ${person.lastName}`.trim() || person.email,
        email: person.email,
      };
    });

  const getPrincipal = (sessionId: string): AccountPrincipal | null => {
    const row = selectPrincipal.get(
      sessionId,
      DateTime.formatIso(DateTime.makeUnsafe(options.now())),
    );

    return row ? principalRow.parse(row) : null;
  };

  const authenticate = async (headers: Headers) => {
    const result = await auth.api.getSession({ headers });

    return result ? getPrincipal(result.session.id) : null;
  };

  const setup = async (value: unknown) => {
    const input = OrganizationSetupInput.parse(value);
    requireMail();

    if (getOrganization()) {
      throw new APIError("CONFLICT", { message: "This organization is already set up. Sign in." });
    }

    const context = await auth.$context;

    await runWithTransaction(context.adapter, async () => {
      const created = await auth.api.signUpEmail({
        body: {
          email: input.email,
          password: input.password,
          name: `${input.firstName} ${input.lastName}`,
          firstName: input.firstName,
          lastName: input.lastName,
          callbackURL: `${origin}/login`,
        },
      });

      await auth.api.createOrganization({
        body: {
          name: input.organizationName,
          slug: "organization",
          userId: created.user.id,
        },
      });
    });

    return { organization: getOrganization(), verificationRequired: true };
  };

  const publicEndpoints = new Set([
    "/sign-in/email",
    "/sign-out",
    "/get-session",
    "/send-verification-email",
    "/verify-email",
    "/request-password-reset",
    "/reset-password",
    "/organization/accept-invitation",
    "/organization/get-invitation",
  ]);

  const memberEndpoints = new Set([
    "/update-user",
    "/change-password",
    "/list-sessions",
    "/revoke-session",
    "/revoke-other-sessions",
    "/organization/list-members",
  ]);

  const adminEndpoints = new Set([
    "/organization/invite-member",
    "/organization/list-invitations",
    "/organization/cancel-invitation",
    "/organization/update-member-role",
    "/organization/remove-member",
    "/organization/update",
  ]);

  const handle = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname.slice("/api/accounts".length);

    if (path === "/sign-up/email") {
      requireMail();
      const body = (await request.clone().json()) as Record<string, unknown>;
      const email = z.email().safeParse(body.email);

      const invitation =
        typeof body.invitationId === "string"
          ? database
              .prepare(`
            SELECT id FROM invitations
            WHERE id = ? AND lower(email) = ? AND status = 'pending' AND expiresAt > ?
          `)
              .get(
                body.invitationId,
                email.success ? email.data.toLowerCase() : "",
                DateTime.formatIso(DateTime.makeUnsafe(options.now())),
              )
          : undefined;

      if (!invitation) {
        return Response.json(
          { message: "A valid invitation for this email is required." },
          { status: 403 },
        );
      }
    } else if (memberEndpoints.has(path) || adminEndpoints.has(path)) {
      const principal = await authenticate(request.headers);

      if (!principal || (adminEndpoints.has(path) && principal.role !== "admin")) {
        return Response.json({ message: "Organization access required." }, { status: 403 });
      }
    } else if (!publicEndpoints.has(path) && !path.startsWith("/reset-password/")) {
      return Response.json({ message: "Not found." }, { status: 404 });
    }

    return auth.handler(request);
  };

  const revokeSession = (sessionId: string) => {
    database.prepare("DELETE FROM user_sessions WHERE id = ?").run(sessionId);
  };

  return {
    auth,
    getOrganization,
    getPrincipal,
    listPeople,
    authenticate,
    setup,
    handle,
    revokeSession,
  };
}

export type OrganizationAccountsRuntime = Awaited<
  ReturnType<typeof createOrganizationAccountsRuntime>
>;
