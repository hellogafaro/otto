import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
} from "@otto/client-runtime/state/runtime";
import type {
  ComposioConnection,
  ComposioVisibility,
  EnvironmentId,
  McpServer,
} from "@otto/contracts";
import { RiPuzzleLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { Predicate } from "effect";
import { useEffect, useState } from "react";

import { useI18n } from "../../i18n";
import { SkeletonIntegrationGroups } from "../ui/skeleton";
import { cn } from "../../lib/utils";
import { environmentSnapshotAtom } from "../../state/shell";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { MenuItem } from "../ui/menu";
import { toast } from "sonner";
import { AddMenu, CardCountRow, CustomizeGroup, CustomizeRow } from "./customize-group";
import { useGitHubIntegration } from "./github-integration";
import { McpServerDialog } from "./mcp-server-dialog";

export function useComposio(environmentId: EnvironmentId) {
  const status = useEnvironmentQuery(
    serverEnvironment.composioStatus({ environmentId, input: {} }),
  );

  const authorize = useAtomCommand(serverEnvironment.authorizeComposio, { reportFailure: false });
  const createAuthConfig = useAtomCommand(serverEnvironment.createComposioAuthConfig, {
    reportFailure: false,
  });
  const disconnect = useAtomCommand(serverEnvironment.disconnectComposio, { reportFailure: false });

  const update = useAtomCommand(serverEnvironment.updateComposioConnection, {
    reportFailure: false,
  });

  /** Toasts a failed command and says whether it failed. */
  const failed = (title: string, result: AtomCommandResult<unknown, unknown>): boolean => {
    if (!Predicate.isTagged(result, "Failure")) return false;

    if (isAtomCommandInterrupted(result)) return true;

    toast.error(title);

    return true;
  };

  return { status, authorize, createAuthConfig, disconnect, update, failed };
}

/** An app's logo from Composio's catalog, or its first letter on a quiet tile. */
export function AppLogo({
  src,
  name,
  className,
}: {
  readonly src?: string | undefined;
  readonly name: string;
  readonly className: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-sm",
        className,
      )}
    >
      {src ? (
        <img alt="" className="size-full object-contain" src={src} />
      ) : (
        <span aria-hidden className="text-11px font-medium text-muted-foreground">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

export function ConnectionStatus({ connection }: { readonly connection: ComposioConnection }) {
  const { t } = useI18n();

  if (connection.status === "ACTIVE") return <Badge variant="success">{t("Connected")}</Badge>;

  return connection.status === "INITIATED" || connection.status === "INITIALIZING" ? (
    <Badge variant="warning">{t("Waiting for sign-in")}</Badge>
  ) : (
    <Badge variant="error">{t("Needs reconnecting")}</Badge>
  );
}

export const serverHost = (server: McpServer, t: ReturnType<typeof useI18n>["t"]) =>
  server.transport === "url" ? new URL(server.url).host : t("Local command, not supported");

/**
 * Otto: Settings → Integrations: everything that gives bots tools, GitHub, Composio apps and
 * remote MCP servers alike. Two groups copy Capy's MCP & plugins page: Yours (only you and the
 * bots you own) and Team (every member's bots). Each card's first row counts its integrations and
 * holds the plus with Connect GitHub, Connect an app and Add MCP server for that group. Connect
 * an app shows only when the server has COMPOSIO_API_KEY; there is no key setting.
 */
export function CustomizeIntegrations({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const { t, plural } = useI18n();
  const navigate = useNavigate();
  const composio = useComposio(environmentId);
  const github = useGitHubIntegration(environmentId);
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId));
  const servers = snapshot?.mcpServers ?? [];
  const composioSettled = composio.status.data !== null || composio.status.error !== null;
  const waiting = snapshot === null || !composioSettled;
  const configured = composio.status.data?.configured === true;
  const connections = composio.status.data?.connections ?? [];
  const [mcpDialog, setMcpDialog] = useState<ComposioVisibility | null>(null);

  // Composio's sign-in finishes in the browser, so pick up the new account on return.
  const refreshStatus = composio.status.refresh;

  useEffect(() => {
    window.addEventListener("focus", refreshStatus);

    return () => window.removeEventListener("focus", refreshStatus);
  }, [refreshStatus]);

  if (waiting && connections.length === 0 && servers.length === 0)
    return <SkeletonIntegrationGroups label={t("Loading settings")} />;

  const groups = (["user", "organization"] as const).map((visibility) => {
    const apps = connections.filter((connection) => connection.visibility === visibility);

    const mcps = servers.filter((server) => (server.visibility ?? "organization") === visibility);

    const team = visibility === "organization";
    const count = apps.length + mcps.length + (github.linked(team) ? 1 : 0);
    const settled = !waiting;

    return (
      <CustomizeGroup
        key={visibility}
        title={visibility === "user" ? t("Yours") : t("Team")}
        empty={
          settled && count === 0
            ? {
                icon: <RiPuzzleLine />,
                description: t("No integrations"),
              }
            : null
        }
        header={
          <CardCountRow
            label={plural(count, { one: "{count} integration", other: "{count} integrations" })}
            action={
              <AddMenu label={visibility === "user" ? t("Add to yours") : t("Add to team")}>
                {github.linked(team) ? null : (
                  <MenuItem onClick={() => void github.connect(team)}>
                    {t("Connect GitHub")}
                  </MenuItem>
                )}
                {configured ? (
                  <MenuItem
                    onClick={() =>
                      void navigate({ to: "/settings/integrations/apps", search: { visibility } })
                    }
                  >
                    {t("Connect an app")}
                  </MenuItem>
                ) : null}
                <MenuItem onClick={() => setMcpDialog(visibility)}>{t("Add MCP server")}</MenuItem>
              </AddMenu>
            }
          />
        }
      >
        {github.row(team)}
        {apps.map((connection) => {
          const name = connection.toolkitName ?? connection.toolkitSlug;

          return (
            <CustomizeRow
              key={`app:${connection.id}`}
              logo={<AppLogo src={connection.logoUrl} name={name} className="size-4" />}
              name={name}
              detail={connection.alias ?? connection.accountName}
              status={<ConnectionStatus connection={connection} />}
              onOpen={() =>
                void navigate({
                  to: "/settings/integrations/apps/$slug",
                  params: { slug: connection.toolkitSlug },
                  search: { visibility },
                })
              }
            />
          );
        })}
        {mcps.map((server) => {
          const host = serverHost(server, t);

          return (
            <CustomizeRow
              key={`mcp:${server.id}`}
              logo={<RiPuzzleLine aria-hidden className="size-4" />}
              name={server.name}
              detail={t("MCP server · {host}", { host })}
              status={server.enabled ? null : <Badge variant="quiet">{t("Off")}</Badge>}
              onOpen={() =>
                void navigate({
                  to: "/settings/integrations/mcp/$id",
                  params: { id: server.id },
                })
              }
            />
          );
        })}
      </CustomizeGroup>
    );
  });

  return (
    <div className="flex flex-col gap-10">
      {composio.status.error ? (
        <p className="text-13px text-destructive-foreground">
          {t("Could not reach Composio: {error}", { error: String(composio.status.error) })}
        </p>
      ) : null}
      {groups}
      {github.dialogs}
      {mcpDialog ? (
        <McpServerDialog
          environmentId={environmentId}
          server={null}
          visibility={mcpDialog}
          open
          onOpenChange={(next) => (next ? undefined : setMcpDialog(null))}
        />
      ) : null}
    </div>
  );
}
