import { DomainError } from "@otto/shared";
import { z } from "zod";
import { privateEndpoint, readServiceJson } from "./service-http";

/** Server-only: never returned to a human or computer. */
export const ACCOUNT_CREDENTIAL = z
  .object({
    provider: z.literal("codex"),
    accountId: z.string().min(1).max(256),
    accessToken: z.string().min(1).max(32768),
    refreshToken: z.string().min(1).max(32768),
    expired: z.iso.datetime({ offset: true }),
    idToken: z.string().max(32768).optional(),
    planType: z.string().max(100).optional(),
  })
  .strict();
export type AccountCredential = z.infer<typeof ACCOUNT_CREDENTIAL>;
export const ACCOUNT_AUTH = z
  .object({
    credential: ACCOUNT_CREDENTIAL,
    authenticatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type AccountAuth = z.infer<typeof ACCOUNT_AUTH>;
export function credentialFingerprint(credential: AccountCredential) {
  return new Bun.CryptoHasher("sha256")
    .update(
      JSON.stringify([
        credential.accountId,
        credential.accessToken,
        credential.refreshToken,
        credential.idToken ?? "",
        credential.expired,
      ]),
    )
    .digest("hex");
}
/** OAuth establishes token validity; this check prevents refreshed/authenticated foreign account identity. */
export function requireCredentialIdentity(credential: AccountCredential) {
  try {
    const payload = credential.accessToken.split(".")[1];
    if (!payload) throw new Error();
    const claims = z
      .object({
        "https://api.openai.com/auth": z.object({
          chatgpt_account_id: z.string(),
        }),
      })
      .parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (
      claims["https://api.openai.com/auth"].chatgpt_account_id !==
      credential.accountId
    )
      throw new Error();
  } catch {
    throw new DomainError("forbidden", "Account identity mismatch");
  }
}
export interface AccountSecretScope {
  workspaceId: string;
  projectId: string;
  environment: string;
  secretPath: string;
}
/** Explicit verified workspace bindings only. No global secret listing, environment lookup, auth file or fallback store. */
export function createInfisicalAccounts(options: {
  endpoint: string;
  bindings: readonly AccountSecretScope[];
  getAccessToken(signal: AbortSignal): Promise<string>;
  allowLoopbackHttp?: boolean;
}) {
  const endpoint = privateEndpoint(options.endpoint, options.allowLoopbackHttp);
  async function request(
    workspaceId: string,
    id: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    signal: AbortSignal,
    auth?: AccountAuth,
  ) {
    z.uuid().parse(id);
    const scope = options.bindings.find(
      (binding) => binding.workspaceId === workspaceId,
    );
    if (!scope)
      throw new DomainError(
        "unavailable",
        "Account secret scope not configured",
      );
    const token = await options.getAccessToken(signal);
    const url = new URL(
      `/api/v4/secrets/OTTO_ACCOUNT_${id.replaceAll("-", "_")}`,
      endpoint,
    );
    const fields = {
      projectId: scope.projectId,
      environment: scope.environment,
      secretPath: scope.secretPath,
      type: "shared",
    };
    if (method === "GET")
      url.search = new URLSearchParams({
        ...fields,
        viewSecretValue: "true",
        expandSecretReferences: "false",
        includeImports: "false",
      }).toString();
    const response = await fetch(url, {
      method,
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body:
        method === "GET"
          ? undefined
          : JSON.stringify(
              method === "DELETE"
                ? fields
                : {
                    ...fields,
                    secretValue: JSON.stringify(auth),
                    skipMultilineEncoding: true,
                  },
            ),
    });
    if (method === "DELETE") {
      await response.body?.cancel();
      // An already-missing secret is the state we want.
      if (!response.ok && response.status !== 404)
        throw new DomainError("unavailable", "Account secret operation failed");
      return null;
    }
    if (method === "GET" && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DomainError("unavailable", "Account secret operation failed");
    }
    const parsed = z
      .object({ secret: z.object({ secretValue: z.string().max(98304) }) })
      .safeParse(await readServiceJson(response, 131072));
    if (!parsed.success)
      throw new DomainError("unavailable", "Account secret response invalid");
    const value = ACCOUNT_AUTH.safeParse(
      JSON.parse(parsed.data.secret.secretValue),
    );
    if (!value.success)
      throw new DomainError("unavailable", "Account credential invalid");
    requireCredentialIdentity(value.data.credential);
    return value.data;
  }
  return {
    read: (workspaceId: string, id: string, signal: AbortSignal) =>
      request(workspaceId, id, "GET", signal),
    async remove(workspaceId: string, id: string, signal: AbortSignal) {
      await request(workspaceId, id, "DELETE", signal);
      if (await request(workspaceId, id, "GET", signal))
        throw new DomainError("unavailable", "Account removal unconfirmed");
    },
    async write(
      workspaceId: string,
      id: string,
      current: AccountAuth | null,
      auth: AccountAuth,
      signal: AbortSignal,
    ) {
      requireCredentialIdentity(auth.credential);
      if (current && current.credential.accountId !== auth.credential.accountId)
        throw new DomainError("conflict", "Account identity is immutable");
      const saved = await request(
        workspaceId,
        id,
        current ? "PATCH" : "POST",
        signal,
        auth,
      );
      const confirmed = await request(workspaceId, id, "GET", signal);
      if (
        !saved ||
        !confirmed ||
        confirmed.authenticatedAt !== auth.authenticatedAt ||
        credentialFingerprint(confirmed.credential) !==
          credentialFingerprint(auth.credential)
      )
        throw new DomainError("unavailable", "Account persistence unconfirmed");
      return confirmed;
    },
  };
}
export type InfisicalAccounts = ReturnType<typeof createInfisicalAccounts>;
