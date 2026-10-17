import type { McpServer } from "@otto/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";

const runtimeHeaders = new WeakMap<McpServer, Readonly<Record<string, string>>>();

/** Where one server's OAuth tokens live, the shape the MCP client's OAuth provider reads. */
export interface McpOAuthStorage {
  readonly get: (key: string) => Promise<string | undefined>;
  readonly set: (key: string, value: string) => Promise<void>;
  readonly delete: (key: string) => Promise<void>;
}

const runtimeOAuthStorage = new WeakMap<McpServer, McpOAuthStorage>();

export function withMcpRuntimeHeaders<T extends McpServer>(
  server: T,
  headers: Readonly<Record<string, string>>,
): T {
  runtimeHeaders.set(server, headers);

  return server;
}

export function withMcpOAuthStorage<T extends McpServer>(server: T, storage: McpOAuthStorage): T {
  runtimeOAuthStorage.set(server, storage);

  return server;
}

export function getMcpOAuthStorage(server: McpServer): McpOAuthStorage | undefined {
  return runtimeOAuthStorage.get(server);
}

export function getMcpRuntimeHeaders(server: McpServer): Readonly<Record<string, string>> {
  return runtimeHeaders.get(server) ?? {};
}

function sameHeaders(left: McpServer, right: McpServer): boolean {
  const leftHeaders = getMcpRuntimeHeaders(left);
  const rightHeaders = getMcpRuntimeHeaders(right);

  // HTTP field names are case-insensitive. OAuth refreshes can return the same
  // credential under a different casing without changing the MCP connection.
  const normalize = (headers: Readonly<Record<string, string>>) =>
    new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));

  const normalizedLeft = normalize(leftHeaders);
  const normalizedRight = normalize(rightHeaders);
  const names = [...normalizedLeft.keys()];

  return (
    names.length === normalizedRight.size &&
    names.every((name) => normalizedLeft.get(name) === normalizedRight.get(name))
  );
}

function sameServer(left: McpServer, right: McpServer): boolean {
  if (
    left.id !== right.id ||
    left.name !== right.name ||
    left.transport !== right.transport ||
    !sameHeaders(left, right)
  ) {
    return false;
  }

  if (left.transport === "url" && right.transport === "url") return left.url === right.url;

  if (left.transport !== "stdio" || right.transport !== "stdio") return false;
  const leftArgs = left.args ?? [];
  const rightArgs = right.args ?? [];

  return (
    left.command === right.command &&
    leftArgs.length === rightArgs.length &&
    leftArgs.every((argument, index) => argument === rightArgs[index])
  );
}

export function sameMcpServerConfigurations(
  left: readonly McpServer[],
  right: readonly McpServer[],
): boolean {
  if (left.length !== right.length) return false;

  return left.every((server) => {
    const other = right.find((candidate) => candidate.id === server.id);

    return other !== undefined && sameServer(server, other);
  });
}

/**
 * Prompt section with the user-set guidance for each attached MCP server, or an
 * empty string when no server has instructions.
 */
export function formatMcpServerInstructions(servers: readonly McpServer[]): string {
  const lines = servers.flatMap((server) =>
    server.instructions?.trim()
      ? [`- ${server.name} (${server.id}): ${server.instructions.trim()}`]
      : [],
  );

  return lines.join("\n");
}

export function toAcpMcpServers(
  servers: readonly McpServer[],
): ReadonlyArray<EffectAcpSchema.McpServer> {
  return servers.map((server) =>
    server.transport === "url"
      ? {
          type: "http" as const,
          name: server.name,
          url: server.url,
          headers: Object.entries(getMcpRuntimeHeaders(server)).map(([name, value]) => ({
            name,
            value,
          })),
        }
      : {
          name: server.name,
          command: server.command,
          args: [...(server.args ?? [])],
          env: [],
        },
  );
}

export function toClaudeMcpServers(servers: readonly McpServer[]) {
  return Object.fromEntries(
    servers.map((server) => [
      String(server.id),
      server.transport === "url"
        ? { type: "http" as const, url: server.url, headers: getMcpRuntimeHeaders(server) }
        : {
            type: "stdio" as const,
            command: server.command,
            args: [...(server.args ?? [])],
          },
    ]),
  );
}
