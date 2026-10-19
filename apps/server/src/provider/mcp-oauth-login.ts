import { createRequire } from "node:module";

import type { McpOAuthStorage } from "./mcp-server-config.ts";
import {
  type OttoMcpOAuthIdentity,
  ottoMcpOAuthClientDocument,
} from "./mcp-oauth-public.ts";

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingSignIn {
  readonly provider: object;
  readonly serverUrl: string;
  readonly resolve: () => void;
  readonly reject: (cause: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const pendingByState = new Map<string, PendingSignIn>();

export function resetMcpOAuthSignInsForTests(): void {
  for (const pending of pendingByState.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Sign-in was reset."));
  }
  pendingByState.clear();
}

function page(status: number, message: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Otto</title></head><body><p>${message}</p></body></html>`;

  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function failPending(state: string, message: string): void {
  const pending = pendingByState.get(state);

  if (!pending) return;

  pendingByState.delete(state);
  clearTimeout(pending.timer);
  pending.reject(new Error(message));
}

async function loadMcpAuth(): Promise<{
  readonly auth: (
    provider: object,
    options: {
      serverUrl: string;
      authorizationCode?: string;
      iss?: string;
    },
  ) => Promise<string>;
  readonly MCPOAuthClientProvider: new (options: {
    redirectUrl: string;
    clientMetadataUrl: string;
    clientMetadata: {
      client_id: string;
      redirect_uris: string[];
      client_name: string;
      grant_types: string[];
      response_types: string[];
    };
    storage: McpOAuthStorage;
    onRedirectToAuthorization: (url: URL) => void;
  }) => object;
}> {
  const fromHere = createRequire(import.meta.url);
  const fromCodeSdk = createRequire(fromHere.resolve("@mastra/code-sdk/package.json"));
  const mcp = fromCodeSdk("@mastra/mcp") as {
    MCPOAuthClientProvider: new (options: {
      redirectUrl: string;
      clientMetadataUrl: string;
      clientMetadata: {
        client_id: string;
        redirect_uris: string[];
        client_name: string;
        grant_types: string[];
        response_types: string[];
      };
      storage: McpOAuthStorage;
      onRedirectToAuthorization: (url: URL) => void;
    }) => object;
  };
  const fromMcp = createRequire(fromCodeSdk.resolve("@mastra/mcp/package.json"));
  const client = fromMcp("@modelcontextprotocol/client") as {
    auth: (
      provider: object,
      options: { serverUrl: string; authorizationCode?: string; iss?: string },
    ) => Promise<string>;
  };

  return { auth: client.auth, MCPOAuthClientProvider: mcp.MCPOAuthClientProvider };
}

export async function signInHostedMcpOAuth(input: {
  readonly serverUrl: string;
  readonly storage: McpOAuthStorage;
  readonly identity: OttoMcpOAuthIdentity;
  readonly onAuthorizationUrl: (url: string) => void;
  readonly signal?: AbortSignal;
}): Promise<void> {
  const { auth, MCPOAuthClientProvider } = await loadMcpAuth();
  const document = ottoMcpOAuthClientDocument(input.identity);
  let authorizationUrl: string | undefined;

  const provider = new MCPOAuthClientProvider({
    redirectUrl: input.identity.redirectUrl,
    clientMetadataUrl: input.identity.clientMetadataUrl,
    clientMetadata: {
      client_id: document.client_id,
      redirect_uris: document.redirect_uris,
      client_name: document.client_name,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    storage: input.storage,
    onRedirectToAuthorization: (url) => {
      authorizationUrl = url.toString();
    },
  });

  const result = await auth(provider, { serverUrl: input.serverUrl });

  if (result === "AUTHORIZED") return;

  if (!authorizationUrl) {
    throw new Error("The authorization server did not return a sign-in URL.");
  }

  const state = new URL(authorizationUrl).searchParams.get("state");

  if (!state) {
    throw new Error("The authorization server did not return a sign-in state.");
  }

  await new Promise<void>((resolve, reject) => {
    const finish = (cause?: Error) => {
      const pending = pendingByState.get(state);

      if (pending) {
        pendingByState.delete(state);
        clearTimeout(pending.timer);
      }

      input.signal?.removeEventListener("abort", onAbort);

      if (cause) reject(cause);
      else resolve();
    };

    const onAbort = () => finish(new Error("Authentication cancelled."));

    const timer = setTimeout(() => finish(new Error("Sign-in timed out.")), SIGN_IN_TIMEOUT_MS);

    pendingByState.set(state, {
      provider,
      serverUrl: input.serverUrl,
      resolve: () => finish(),
      reject: finish,
      timer,
    });

    if (input.signal?.aborted) {
      onAbort();
      return;
    }

    input.signal?.addEventListener("abort", onAbort, { once: true });
    input.onAuthorizationUrl(authorizationUrl!);
  });
}

/** Completes the browser callback. The page never includes the authorization code. */
export async function completeMcpOAuthCallback(params: URLSearchParams): Promise<Response> {
  const state = params.get("state") ?? "";
  const pending = pendingByState.get(state);

  if (!pending) return page(400, "This sign-in link is no longer valid. Start sign-in again in Otto.");

  if (params.get("error")) {
    failPending(state, "Sign-in was cancelled.");
    return page(400, "Sign-in was cancelled. You can close this tab.");
  }

  const code = params.get("code");

  if (!code) {
    failPending(state, "Sign-in did not include an authorization code.");
    return page(400, "Sign-in could not be completed. You can close this tab.");
  }

  try {
    const { auth } = await loadMcpAuth();

    await auth(pending.provider, {
      serverUrl: pending.serverUrl,
      authorizationCode: code,
      ...(params.get("iss") ? { iss: params.get("iss")! } : {}),
    });
    pendingByState.delete(state);
    clearTimeout(pending.timer);
    pending.resolve();
    return page(200, "Signed in. You can close this tab and return to Otto.");
  } catch {
    failPending(state, "Sign-in could not be completed.");
    return page(400, "Sign-in could not be completed. You can close this tab.");
  }
}
