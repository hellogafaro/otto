import * as Schema from "effect/Schema";

import { AuthSessionId, IsoDateTime, TrimmedNonEmptyString, Visibility } from "./base-schemas.ts";

export const McpServerId = TrimmedNonEmptyString.pipe(Schema.brand("McpServerId"));

export type McpServerId = typeof McpServerId.Type;

export const McpServerTransport = Schema.Literals(["stdio", "url"]);

export type McpServerTransport = typeof McpServerTransport.Type;

export const McpServerUrl = TrimmedNonEmptyString.check(
  Schema.makeFilter((value) => {
    if (!/^https?:\/\//i.test(value)) {
      return "MCP server URL must be an absolute HTTP or HTTPS URL.";
    }

    try {
      const url = new URL(value);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return "MCP server URL must be an absolute HTTP or HTTPS URL.";
      }

      // The registry stores no credentials; a userinfo URL would smuggle one
      // into plain event payloads.
      if (url.username !== "" || url.password !== "") {
        return "MCP server URL must not contain credentials.";
      }

      return true;
    } catch {
      return "MCP server URL must be an absolute HTTP or HTTPS URL.";
    }
  }),
);

export const MCP_SERVER_INSTRUCTIONS_MAX_CHARS = 4_000;

/**
 * Guidance a bot receives about when and how to use one MCP server. Instructions
 * are plain text, not credentials, and an empty value clears them.
 */
export const McpServerInstructions = Schema.String.check(
  Schema.isMaxLength(MCP_SERVER_INSTRUCTIONS_MAX_CHARS),
);

const StdioMcpServerConfiguration = Schema.Struct({
  name: TrimmedNonEmptyString,
  transport: Schema.Literal("stdio"),
  command: TrimmedNonEmptyString,
  args: Schema.optional(Schema.Array(Schema.String)),
});

const UrlMcpServerConfiguration = Schema.Struct({
  name: TrimmedNonEmptyString,
  transport: Schema.Literal("url"),
  url: McpServerUrl,
});

export const McpServerConfiguration = Schema.Union([
  StdioMcpServerConfiguration,
  UrlMcpServerConfiguration,
]);

export type McpServerConfiguration = typeof McpServerConfiguration.Type;

/** `user` servers belong to the person who added them; `organization` servers serve every bot. */
export const McpServerVisibility = Visibility;

export type McpServerVisibility = typeof McpServerVisibility.Type;

/** The person who added a server, filled in by the server from the signed-in person. */
export const McpServerOwner = Schema.Struct({
  personId: AuthSessionId,
  displayName: TrimmedNonEmptyString,
});

export type McpServerOwner = typeof McpServerOwner.Type;

/** All absent on servers added before access was recorded, or by a bot: those serve the workspace. */
const McpServerAccessFields = {
  visibility: Schema.optional(McpServerVisibility),
  createdBy: Schema.optional(McpServerOwner),
};

/**
 * A raw MCP server registration. Runtime launch, Mastra tool
 * attachment, Executor, Composio, and per-bot enablement are outside this registry.
 * Credentials stay in external secret storage and never belong in this record.
 */
export const McpServer = Schema.Union([
  Schema.Struct({
    id: McpServerId,
    ...StdioMcpServerConfiguration.fields,
    instructions: Schema.optional(McpServerInstructions),
    enabled: Schema.Boolean,
    ...McpServerAccessFields,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  }),
  Schema.Struct({
    id: McpServerId,
    ...UrlMcpServerConfiguration.fields,
    instructions: Schema.optional(McpServerInstructions),
    enabled: Schema.Boolean,
    ...McpServerAccessFields,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  }),
]);

export type McpServer = typeof McpServer.Type;

/**
 * Workspace servers serve everyone; a personal one serves the person who added it and the
 * bots that person owns. People chatting with such a bot use it without seeing it.
 */
export function canUseMcpServer(
  server: Pick<McpServer, "visibility" | "createdBy">,
  personId: string | null,
): boolean {
  return (
    server.visibility !== "user" || (personId !== null && server.createdBy?.personId === personId)
  );
}

/**
 * Resolve the MCP registry for one bot: enabled workspace servers, plus its owner's
 * personal servers, minus the ones the bot switched off.
 */
export function resolveBotMcpServers(
  servers: readonly McpServer[],
  disabledMcpServerIds: readonly McpServerId[],
  ownerPersonId: string | null = null,
): readonly McpServer[] {
  const excluded = new Set(disabledMcpServerIds);

  return servers.filter(
    (server) =>
      server.enabled && !excluded.has(server.id) && canUseMcpServer(server, ownerPersonId),
  );
}
