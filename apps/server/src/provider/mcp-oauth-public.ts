/** Public OAuth client identity for remote MCP servers. */

export const MCP_OAUTH_CLIENT_NAME = "Otto";

/** Authorization servers fetch this document to learn the client name and redirect. */
export const MCP_OAUTH_CLIENT_METADATA_PATH = "/.well-known/oauth-client/otto.json";

/** Browser callback after the person approves a remote MCP server. */
export const MCP_OAUTH_CALLBACK_PATH = "/oauth/mcp/callback";

export interface OttoMcpOAuthIdentity {
  readonly clientName: typeof MCP_OAUTH_CLIENT_NAME;
  readonly clientMetadataUrl: string;
  readonly redirectUrl: string;
  readonly clientUri: string;
}

/**
 * Client identity for wherever this server is hosted.
 * Client ID Metadata Documents must be https, so a missing or non-https public
 * origin cannot sign in. The origin is `OTTO_PUBLIC_URL` / `--public-url`.
 */
export function ottoMcpOAuthIdentity(
  publicOrigin: string | null | undefined,
): OttoMcpOAuthIdentity | undefined {
  if (!publicOrigin?.startsWith("https://")) return undefined;

  const origin = publicOrigin.replace(/\/$/, "");

  return {
    clientName: MCP_OAUTH_CLIENT_NAME,
    clientMetadataUrl: `${origin}${MCP_OAUTH_CLIENT_METADATA_PATH}`,
    redirectUrl: `${origin}${MCP_OAUTH_CALLBACK_PATH}`,
    clientUri: `${origin}/`,
  };
}

/** Document served at `clientMetadataUrl`. The name and redirect must match the login request. */
export function ottoMcpOAuthClientDocument(identity: OttoMcpOAuthIdentity) {
  return {
    client_id: identity.clientMetadataUrl,
    client_name: identity.clientName,
    client_uri: identity.clientUri,
    redirect_uris: [identity.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}
