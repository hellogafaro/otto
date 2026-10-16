import { runWithTransaction } from "@better-auth/core/context";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { bearer, emailOTP, organization } from "better-auth/plugins";
import { adminAc, memberAc } from "better-auth/plugins/organization/access";
import * as NodeCrypto from "node:crypto";
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
    setupCode: z.string().max(256).optional(),
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

/** Otto: The desktop app's renderer origins; they sign in with bearer sessions, not cookies. */
export const DESKTOP_RENDERER_ORIGINS = ["otto://app", "otto-dev://app"];

export async function createOrganizationAccountsRuntime(options: {
  readonly database: NodeSqlite.DatabaseSync;
  readonly secret: string;
  readonly origin: string;
  readonly cookieName: string;
  readonly mailConfigured: boolean;
  /** OTTO_SETUP_TOKEN: when set, setup needs this code and the owner's email counts as verified. */
  readonly setupToken?: string | undefined;
  /** Containers refuse setup without a setup token, so a missing variable fails closed. */
  readonly requireSetupToken?: boolean;
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
    trustedOrigins: [origin, ...DESKTOP_RENDERER_ORIGINS],
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
      emailOTP({
        disableSignUp: true,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "sign-in") return;
          requireMail();
          await options.sendEmail({
            to: email,
            subject: `${otp} is your Otto sign-in code`,
            text: `Your Otto sign-in code is ${otp}. It expires in 5 minutes and works once.\n\nIf you did not try to sign in, ignore this email.`,
          });
        },
      }),
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

  const setupCodeMatches = (code: string | undefined) => {
    const digest = (value: string) => NodeCrypto.createHash("sha256").update(value).digest();

    return (
      options.setupToken !== undefined &&
      NodeCrypto.timingSafeEqual(digest(code?.trim() ?? ""), digest(options.setupToken))
    );
  };

  const setup = async (value: unknown) => {
    const input = OrganizationSetupInput.parse(value);

    if (getOrganization()) {
      throw new APIError("CONFLICT", { message: "This organization is already set up. Sign in." });
    }

    const verified = options.setupToken !== undefined;

    if (verified && !setupCodeMatches(input.setupCode)) {
      throw new APIError("FORBIDDEN", {
        code: "INVALID_SETUP_CODE",
        message: "That setup code is not right.",
      });
    }

    if (!verified && options.requireSetupToken) {
      throw new APIError("SERVICE_UNAVAILABLE", {
        code: "SETUP_TOKEN_NOT_CONFIGURED",
        message: "Set OTTO_SETUP_TOKEN on the server before setting up the organization.",
      });
    }

    if (!verified) requireMail();
    const context = await auth.$context;

    await runWithTransaction(context.adapter, async () => {
      const user = await context.internalAdapter.createUser(
        {
          email: input.email,
          name: `${input.firstName} ${input.lastName}`,
          firstName: input.firstName,
          lastName: input.lastName,
          emailVerified: verified,
        },
        { method: "email-password" },
      );

      await context.internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: await context.password.hash(input.password),
      });

      await auth.api.createOrganization({
        body: { name: input.organizationName, slug: "organization", userId: user.id },
      });

      if (!verified) {
        await auth.api.sendVerificationEmail({
          body: { email: input.email, callbackURL: `${origin}/login` },
        });
      }
    });

    return { organization: getOrganization(), verificationRequired: !verified };
  };

  // Otto: with mail, people sign in with a one-time email code; the password is the fallback
  // only for servers without mail.
  const publicEndpoints = new Set([
    ...(options.mailConfigured
      ? ["/email-otp/send-verification-otp", "/sign-in/email-otp"]
      : ["/sign-in/email"]),
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
