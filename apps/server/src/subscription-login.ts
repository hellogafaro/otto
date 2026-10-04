import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import type { Database } from "@otto/db";
import { DomainError, required, withCleanup } from "@otto/shared";
import { getSubscription, updateSubscription } from "@otto/subscriptions";
import {
  getGatewaySubscription,
  qualifySubscription,
} from "@otto/subscriptions/server";
import {
  type Actor,
  inWorkspace,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import {
  ACCOUNT_CREDENTIAL,
  type AccountCredential,
  credentialFingerprint,
  type InfisicalAccounts,
} from "./subscription-secrets";

export type LoginEvent =
  | {
      type: "device_code";
      verificationUri: string;
      userCode: string;
      expiresInSeconds: number;
    }
  | { type: "connected"; provider: "codex" }
  | { type: "error"; code: "login_failed" };

/** One structured SDK login, one Infisical record per Subscription, never native auth files. */
export function createSubscriptionLogin(
  db: Database,
  secrets: InfisicalAccounts,
  pool: Pool,
) {
  const logins = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  let closing = false;
  async function creator(
    workspaceId: string,
    actor: Actor,
    id: string,
    database: Database = db,
  ) {
    return inWorkspace(
      database,
      workspaceId,
      actor,
      async (c) => {
        requireHuman(c);
        requireWriter(c);
        const account = await getSubscription(c, id);
        if (account.createdBy !== actor.userId)
          throw new DomainError("forbidden");
        return account;
      },
      false,
    );
  }
  /** Session advisory lock serializes secret CAS; all metadata work reuses this client, with workspace transactions ending before I/O. */
  async function lock<T>(id: string, work: (database: Database) => Promise<T>) {
    const client = await pool.connect();
    let acquired = false;
    let broken = false;
    return withCleanup(
      async () => {
        await client.query("select pg_advisory_lock(hashtextextended($1,0))", [
          `subscription-auth:${id}`,
        ]);
        acquired = true;
        return work(drizzle(client));
      },
      async () => {
        try {
          if (acquired)
            await client.query(
              "select pg_advisory_unlock(hashtextextended($1,0))",
              [`subscription-auth:${id}`],
            );
        } catch (error) {
          broken = true;
          throw error;
        } finally {
          client.release(broken);
        }
      },
    );
  }
  return {
    authorize: creator,
    async login(
      workspaceId: string,
      actor: Actor,
      id: string,
      notify: (event: LoginEvent) => void,
      signal: AbortSignal,
    ) {
      const account = await creator(workspaceId, actor, id);
      if (closing || logins.size >= 4)
        throw new DomainError("unavailable", "Account login capacity");
      if (logins.has(id))
        throw new DomainError("conflict", "Account login pending");
      if (account.status === "disabled")
        throw new DomainError("forbidden", "Request reauthentication first");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) controller.abort();
      const timer = setTimeout(abort, 300000);
      let joined: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        joined = resolve;
      });
      logins.set(id, { controller, done });
      try {
        await inWorkspace(db, workspaceId, actor, (c) =>
          updateSubscription(c, id, { status: "needs_auth" }),
        );
        const initial = await secrets.read(workspaceId, id, controller.signal);
        await creator(workspaceId, actor, id);
        const oauth = required(
          openaiCodexProvider().auth?.oauth,
          "unavailable",
        );
        const credential = await oauth.login({
          signal: controller.signal,
          async prompt(input) {
            if (
              input.type !== "select" ||
              !input.options.some((option) => option.id === "device_code")
            )
              throw new DomainError(
                "unavailable",
                "Unsupported account login interaction",
              );
            return "device_code";
          },
          notify(event) {
            if (event.type !== "device_code") return;
            if (
              event.verificationUri !==
                "https://auth.openai.com/codex/device" ||
              !event.userCode ||
              event.userCode.length > 128
            )
              throw new DomainError(
                "unavailable",
                "Invalid account login interaction",
              );
            notify({
              type: "device_code",
              verificationUri: event.verificationUri,
              userCode: event.userCode,
              expiresInSeconds: Math.min(event.expiresInSeconds ?? 300, 300),
            });
          },
        });
        const parsed = ACCOUNT_CREDENTIAL.parse({
          provider: "codex",
          accountId: credential.accountId,
          accessToken: credential.access,
          refreshToken: credential.refresh,
          expired: new Date(credential.expires).toISOString(),
        });
        await lock(id, async (database) => {
          const current = await creator(workspaceId, actor, id, database);
          if (
            controller.signal.aborted ||
            current.status !== "needs_auth" ||
            current.visibility !== account.visibility
          )
            throw new DomainError("forbidden", "Login authorization changed");
          const stored = await secrets.read(workspaceId, id, controller.signal);
          if (
            (stored ? credentialFingerprint(stored.credential) : null) !==
              (initial ? credentialFingerprint(initial.credential) : null) ||
            stored?.authenticatedAt !== initial?.authenticatedAt
          )
            throw new DomainError("conflict", "Account authentication changed");
          const previousAt = stored?.authenticatedAt;
          let authenticatedAt = new Date().toISOString();
          if (authenticatedAt === previousAt) {
            await new Promise<void>((resolve) => setTimeout(resolve, 1));
            authenticatedAt = new Date().toISOString();
          }
          if (previousAt && authenticatedAt <= previousAt)
            throw new DomainError(
              "unavailable",
              "Authentication clock has not advanced",
            );
          await secrets.write(
            workspaceId,
            id,
            stored,
            { credential: parsed, authenticatedAt },
            controller.signal,
          );
          // Async persistence never grants stale creator/member/status authority.
          await inWorkspace(database, workspaceId, actor, async (c) => {
            const current = await getSubscription(c, id);
            if (
              controller.signal.aborted ||
              current.status !== "needs_auth" ||
              current.visibility !== account.visibility
            )
              throw new DomainError("forbidden", "Login authorization changed");
            await qualifySubscription(c, id, "codex");
          });
        });
        notify({ type: "connected", provider: "codex" });
      } catch {
        // This attempt entered needs_auth before I/O. Never invalidate a newer successful authentication.
        notify({ type: "error", code: "login_failed" });
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        controller.abort();
        logins.delete(id);
        joined();
      }
    },
    async read(id: string, signal: AbortSignal) {
      const before = await getGatewaySubscription(db, id);
      const credential = await secrets.read(before.workspaceId, id, signal);
      if (!credential) throw new DomainError("not_found");
      const after = await getGatewaySubscription(db, id);
      if (before.visibility !== after.visibility)
        throw new DomainError("forbidden");
      return {
        ...credential,
        fingerprint: credentialFingerprint(credential.credential),
      };
    },
    async refresh(
      id: string,
      expectedFingerprint: string | null,
      expectedAuthenticatedAt: string,
      credential: AccountCredential,
      signal: AbortSignal,
    ) {
      z.uuid().parse(id);
      return lock(id, async (database) => {
        const before = await getGatewaySubscription(database, id);
        const current = await secrets.read(before.workspaceId, id, signal);
        if (
          (current ? credentialFingerprint(current.credential) : null) !==
            expectedFingerprint ||
          current?.authenticatedAt !== expectedAuthenticatedAt
        )
          throw new DomainError("conflict", "Account authentication changed");
        // Persist uncertainty BEFORE external delivery. A crash/lost acknowledgement cannot leave this account eligible.
        await inWorkspace(
          database,
          before.workspaceId,
          { userId: before.createdBy },
          async (c) => {
            const account = await getSubscription(c, id);
            if (
              account.status !== "enabled" ||
              account.visibility !== before.visibility
            )
              throw new DomainError(
                "forbidden",
                "Account authorization changed",
              );
            await updateSubscription(c, id, { status: "needs_auth" });
          },
        );
        const saved = await secrets.write(
          before.workspaceId,
          id,
          current,
          {
            credential: ACCOUNT_CREDENTIAL.parse(credential),
            authenticatedAt: expectedAuthenticatedAt,
          },
          signal,
        );
        await inWorkspace(
          database,
          before.workspaceId,
          { userId: before.createdBy },
          async (c) => {
            const account = await getSubscription(c, id);
            if (
              signal.aborted ||
              account.status !== "needs_auth" ||
              account.visibility !== before.visibility
            )
              throw new DomainError(
                "forbidden",
                "Account authorization changed",
              );
            await qualifySubscription(c, id, "codex");
          },
        );
        return { fingerprint: credentialFingerprint(saved.credential) };
      });
    },
    async close() {
      closing = true;
      const pending = [...logins.values()];
      for (const entry of pending) entry.controller.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(pending.map((entry) => entry.done)),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new DomainError(
                    "unavailable",
                    "Account login cleanup unconfirmed",
                  ),
                ),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
export type SubscriptionLogin = ReturnType<typeof createSubscriptionLogin>;
