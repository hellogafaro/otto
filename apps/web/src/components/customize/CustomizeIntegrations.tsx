import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
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
import { cn } from "../../lib/utils";
import { environmentMcpServersAtom } from "../../state/mcpServers";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { openSettings } from "../../settingsDialogStore";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { MenuItem } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { AddMenu, CustomizeGroup, CustomizeRow } from "./CustomizeGroup";
import { McpServerDialog } from "./McpServerDialog";

export function useComposio(environmentId: EnvironmentId) {
  const { t } = useI18n();

  const status = useEnvironmentQuery(
    serverEnvironment.composioStatus({ environmentId, input: {} }),
  );

  const configure = useAtomCommand(serverEnvironment.configureComposio, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.removeComposio, { reportFailure: false });
  const authorize = useAtomCommand(serverEnvironment.authorizeComposio, { reportFailure: false });
  const disconnect = useAtomCommand(serverEnvironment.disconnectComposio, { reportFailure: false });

  const update = useAtomCommand(serverEnvironment.updateComposioConnection, {
    reportFailure: false,
  });

  /** Toasts a failed command and says whether it failed. */
  const failed = (title: string, result: AtomCommandResult<unknown, unknown>): boolean => {
    if (!Predicate.isTagged(result, "Failure")) return false;

    if (isAtomCommandInterrupted(result)) return true;
    const error = squashAtomCommandFailure(result);

    toastManager.add({
      type: "error",
      title,
      description: error instanceof Error ? error.message : t("The command failed."),
    });

    return true;
  };

  return { status, configure, remove, authorize, disconnect, update, failed };
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
 * Otto: Customize's Integrations tab: everything that gives bots tools, Composio apps and remote
 * MCP servers alike, since an app is a hosted MCP server. Two groups copy Capy's MCP & plugins
 * page: Yours (only you and the bots you own) and Workspace (every member's bots), each a card
 * with its count and a plus to connect an app or add a server for that group. The Composio key
 * itself lives in Settings → Integrations, and Connect an app opens the app catalog.
 */
export function CustomizeIntegrations({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const composio = useComposio(environmentId);
  const servers = useAtomValue(environmentMcpServersAtom(environmentId));
  const configured = composio.status.data?.configured === true;
  const connections = composio.status.data?.connections ?? [];
  const [mcpDialog, setMcpDialog] = useState<ComposioVisibility | null>(null);

  // Composio's sign-in finishes in the browser, so pick up the new account on return.
  const refreshStatus = composio.status.refresh;

  useEffect(() => {
    window.addEventListener("focus", refreshStatus);

    return () => window.removeEventListener("focus", refreshStatus);
  }, [refreshStatus]);

  if (!composio.status.data) return null;

  const groups = (["user", "organization"] as const).map((visibility) => {
    const apps = connections.filter((connection) => connection.visibility === visibility);

    const mcps = servers.filter((server) => (server.visibility ?? "organization") === visibility);

    const count = apps.length + mcps.length;

    return (
      <CustomizeGroup
        key={visibility}
        title={visibility === "user" ? t("Yours") : t("Team")}
        count={count}
        empty={
          count === 0
            ? {
                icon: <RiPuzzleLine />,
                description: t("No integrations"),
              }
            : null
        }
        action={
          <AddMenu label={visibility === "user" ? t("Add to yours") : t("Add to team")}>
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
      >
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
      {configured ? null : (
        <Alert>
          <AlertTitle>{t("Connect apps with Composio")}</AlertTitle>
          <AlertDescription>
            {t("Add a Composio key in Settings to connect apps like Slack and Gmail.")}
          </AlertDescription>
          <AlertAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openSettings("integrations", null, environmentId)}
            >
              {t("Open settings")}
            </Button>
          </AlertAction>
        </Alert>
      )}
      {groups}
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
