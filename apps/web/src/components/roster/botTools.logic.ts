import {
  canUseMcpServer,
  LIBRARY_SKILLS_FOLDER_ID,
  type ComposioConnection,
  type LibraryFolder,
  type McpServer,
  type McpServerId,
  type ProviderAccessStatus,
} from "@otto/contracts";

import {
  loadCatalog,
  resolveCatalogInstallations,
  type PluginDefinition,
} from "../../../../../plugins";

/** Servers the plugin catalog installed; people add the rest in Customize. */
export function isBuiltinMcpServer(server: McpServer): boolean {
  return server.id.startsWith("builtin-");
}

const CATALOG = loadCatalog();

export interface BotToolItem {
  readonly id: McpServerId;
  readonly kind: "mcp" | "plugin";
  readonly name: string;
  readonly description: string;
  readonly workspaceEnabled: boolean;
  readonly pluginId?: string;
  readonly logo?: PluginDefinition["logo"];
}

export type BotToolStatus = "connected" | "needs-setup" | "error";

export function planBotToolToggle<Id extends string>(
  disabledIds: readonly Id[],
  id: Id,
  enabled: boolean,
): readonly Id[] {
  const next = new Set(disabledIds);

  if (enabled) next.delete(id);
  else next.add(id);

  return [...next];
}

function mcpDescription(server: McpServer): string {
  return server.transport === "url"
    ? server.url
    : [server.command, ...(server.args ?? [])].join(" ");
}

/** Lists the workspace tools a bot can switch on or off, plugins first. */
export function buildBotToolItems(
  servers: readonly McpServer[],
  catalog: readonly PluginDefinition[] = CATALOG,
): readonly BotToolItem[] {
  const serversById = new Map<string, McpServer>(servers.map((server) => [server.id, server]));

  const plugins = resolveCatalogInstallations(servers, catalog).flatMap((installation) => {
    const server = serversById.get(installation.serverId);

    if (!server?.enabled) return [];

    return installation.kind === "catalog"
      ? [
          {
            id: server.id,
            kind: "plugin" as const,
            name: installation.plugin.title,
            description: installation.plugin.description,
            workspaceEnabled: true,
            pluginId: installation.plugin.id,
            logo: installation.plugin.logo,
          },
        ]
      : [
          {
            id: server.id,
            kind: "plugin" as const,
            name: installation.title,
            description: mcpDescription(server),
            workspaceEnabled: true,
          },
        ];
  });

  const mcpServers = servers.flatMap((server) =>
    server.enabled && !isBuiltinMcpServer(server)
      ? [
          {
            id: server.id,
            kind: "mcp" as const,
            name: server.name,
            description: mcpDescription(server),
            workspaceEnabled: true,
          },
        ]
      : [],
  );

  return [...plugins, ...mcpServers].toSorted(
    (left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name),
  );
}

export function isBotToolEnabled(
  item: Pick<BotToolItem, "id" | "workspaceEnabled">,
  disabledIds: readonly McpServerId[],
): boolean {
  return item.workspaceEnabled && !disabledIds.includes(item.id);
}

/**
 * Reads a tool's health from the environment access report. Returns null when
 * the environment reports nothing for it, so the UI never claims a connection
 * it has not seen.
 */
export function botToolStatus(
  item: Pick<BotToolItem, "id" | "pluginId">,
  accessStatuses: readonly ProviderAccessStatus[],
): BotToolStatus | null {
  const access = accessStatuses.find(
    (status) =>
      status.serverId === item.id ||
      (item.pluginId !== undefined && status.pluginId === item.pluginId),
  );

  if (!access) return null;

  switch (access.health) {
    case "healthy":
    case "recovered":
    case "detected":
      return "connected";
    case "missing":
    case "expired":
    case "revoked":
    case "disabled":
      return "needs-setup";
    case "failed":
    case "failed-first-request":
    case "unsupported":
      return "error";
  }
}

/** The MCP servers a bot can use before its own switches: team ones and its owner's personal ones. */
export function botMcpServers(
  servers: readonly McpServer[],
  ownerPersonId: string | null,
): readonly McpServer[] {
  return servers.filter((server) => canUseMcpServer(server, ownerPersonId));
}

/** One connected app account in a bot's Integrations, as the viewer sees it. */
export interface BotAccountItem {
  readonly connection: ComposioConnection;
  readonly enabled: boolean;
}

/**
 * The viewer's app accounts for one bot. A per-bot switch wins; otherwise a team account
 * serves every bot and a personal one (always the viewer's, since nobody sees another
 * person's) the bots its owner owns.
 */
export function buildBotAccountItems(
  connections: readonly ComposioConnection[],
  bot: { readonly id: string; readonly ownerPersonId: string | null },
  viewerPersonId: string | null,
): readonly BotAccountItem[] {
  const ownsBot = viewerPersonId !== null && bot.ownerPersonId === viewerPersonId;

  return connections
    .map((connection) => ({
      connection,
      enabled: connection.botAccess[bot.id] ?? (connection.visibility === "workspace" || ownsBot),
    }))
    .toSorted((left, right) =>
      (left.connection.toolkitName ?? left.connection.toolkitSlug).localeCompare(
        right.connection.toolkitName ?? right.connection.toolkitSlug,
      ),
    );
}

/** The skills a bot uses that the viewer can see: team skills, and the viewer's own on their bots. */
export function botSkillFolders(
  folders: readonly LibraryFolder[],
  ownerPersonId: string | null,
): readonly LibraryFolder[] {
  return folders
    .filter(
      (folder) =>
        folder.parentId === LIBRARY_SKILLS_FOLDER_ID &&
        (folder.visibility === "workspace" ||
          (folder.createdBy.kind === "person" &&
            ownerPersonId !== null &&
            folder.createdBy.personId === ownerPersonId)),
    )
    .toSorted((left, right) => left.title.localeCompare(right.title));
}
