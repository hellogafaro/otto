import { RiGithubFill } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import type { InferResponseType } from "hono/client";
import { useEffect, useState } from "react";
import { isDeniedDomainRead } from "@/components/agents-schedules-mutation-safety";
import { useConfirm } from "@/components/confirm";
import { useAskAgent } from "@/components/floating-chat";
import { RiConnectorLine } from "@/components/icons";
import { QueryState } from "@/components/query-state";
import { read, type workspaceApi } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { ConnectionCredentialDialog } from "./connection-credential";
import { ConnectionOperations } from "./connection-operations";
import {
  Choice,
  Group,
  Row,
  SaveState,
  SettingsFilters,
  SettingsPaging,
  useSettingsAction,
  useSettingsList,
} from "./controls";

type Connection = InferResponseType<
  typeof workspaceApi.connections.$get
>["items"][number];
const sorts = { title: "Name", createdAt: "Created", updatedAt: "Updated" };
const visibilityOptions = { user: "Only you", workspace: "Workspace" };

export function ConnectionSettings() {
  const { api, workspaceId, workspace } = useWorkspace();
  const ask = useAskAgent();
  const list = useSettingsList(sorts, "title");
  const id = list.params.get("connection") || undefined;
  const selected = useQuery({
    queryKey: ["workspace", workspaceId, "settings", "connection", id],
    queryFn: async () => {
      if (!id) throw new Error("Select a connection.");
      return read(
        await api.connections[":id"].$get({ param: { workspaceId, id } }),
      );
    },
    enabled: !!id,
  });
  const type = (["github", "mcp"] as const).find(
    (value) => value === list.params.get("type"),
  );
  const visibility = (["user", "workspace"] as const).find(
    (value) => value === list.params.get("visibility"),
  );
  const connected = (["true", "false"] as const).find(
    (value) => value === list.params.get("connected"),
  );
  const query = useQuery({
    enabled: !id,
    queryKey: [
      "workspace",
      workspaceId,
      "settings",
      "connections",
      list.request,
      type,
      visibility,
      connected,
    ],
    queryFn: async () =>
      read(
        await api.connections.$get({
          param: { workspaceId },
          query: { ...list.request, type, visibility, connected },
        }),
      ),
  });
  if (id)
    return (
      <>
        <Button
          className="self-start"
          variant="outline"
          size="compact"
          onClick={() => list.update({ connection: undefined })}
        >
          All connections
        </Button>
        <QueryState
          pending={selected.isPending}
          error={selected.error}
          retry={selected.refetch}
        />
        {selected.data && !selected.error && (
          <ConnectionDetail key={selected.data.id} connection={selected.data} />
        )}
      </>
    );
  if (
    query.data &&
    !query.error &&
    !query.data.items.length &&
    !type &&
    !visibility &&
    !connected
  )
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No connections</EmptyTitle>
          <EmptyDescription>
            App integrations and remote MCP servers created through the composer
            show up here.
          </EmptyDescription>
        </EmptyHeader>
        {workspace.role !== "viewer" && (
          <EmptyContent>
            <Button
              onClick={() =>
                ask(
                  "Create a Connection for an existing supported GitHub integration or remote HTTP MCP server. Ask for nonsecret account association and explicit scope, then request exact human approval. Never ask for credentials in Chat.",
                )
              }
            >
              Ask agent
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  return (
    <>
      <Group description="App integrations and remote MCP servers. Create and update Connections through the composer; model providers stay in Models.">
        {workspace.role !== "viewer" && (
          <Row title="Create or update">
            <Button
              variant="outline"
              size="compact"
              onClick={() =>
                ask(
                  "Create a Connection for an existing supported GitHub integration or remote HTTP MCP server. Ask for nonsecret account association and explicit scope, then request exact human approval. Never ask me to send credentials in Chat; credential-reference completion is human-only.",
                )
              }
            >
              Ask agent
            </Button>
          </Row>
        )}
      </Group>
      <SettingsFilters>
        <Choice
          label="Connection type"
          value={type ?? "all"}
          options={{ all: "All types", github: "GitHub", mcp: "MCP" }}
          onChange={(value) =>
            list.update({ type: value === "all" ? undefined : value })
          }
        />
        <Choice
          label="Connection visibility"
          value={visibility ?? "all"}
          options={{ all: "All connections", ...visibilityOptions }}
          onChange={(value) =>
            list.update({ visibility: value === "all" ? undefined : value })
          }
        />
        <Choice
          label="Connection status"
          value={connected ?? "all"}
          options={{
            all: "All statuses",
            true: "Connected",
            false: "Disconnected",
          }}
          onChange={(value) =>
            list.update({ connected: value === "all" ? undefined : value })
          }
        />
      </SettingsFilters>
      <QueryState
        pending={query.isPending}
        error={query.error}
        retry={query.refetch}
      />
      {query.data && !query.error && (
        <>
          <Group>
            {query.data.items.map((connection) => (
              <Row
                key={connection.id}
                title={connection.title}
                description={`${connection.type === "github" ? "GitHub" : "MCP"} · ${connection.connected ? "Connected" : "Disconnected"}`}
              >
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => list.update({ connection: connection.id })}
                >
                  Open connection
                </Button>
              </Row>
            ))}
            {!query.data.items.length && (
              <Row
                title="No connections"
                description="Connections created through the composer show up here."
              />
            )}
          </Group>
          <SettingsPaging
            next={query.data.next}
            after={list.after}
            change={(after) => list.update({ after })}
          />
        </>
      )}
    </>
  );
}

function ConnectionDetail({ connection: initial }: { connection: Connection }) {
  const { api, workspaceId, user, workspace } = useWorkspace();
  const ask = useAskAgent();
  const confirm = useConfirm();
  const action = useSettingsAction();
  const [credentials, setCredentials] = useState(false);
  const [operations, setOperations] = useState(false);
  const [readDenied, setReadDenied] = useState<Error>();
  const [externalExpiry, setExternalExpiry] = useState<string | null>(null);
  const param = { workspaceId, id: initial.id };
  const details = useQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "connection-details",
      initial.id,
      initial.editToken,
      initial.connected,
    ],
    queryFn: async () =>
      read(await api.connections[":id"].details.$get({ param })),
    retry: false,
  });
  const current = !details.error ? details.data : undefined;
  const connection = current ?? initial;
  const editable =
    connection.createdBy === user.id && workspace.role !== "viewer";
  useEffect(() => {
    if (details.error && isDeniedDomainRead(details.error))
      setReadDenied(details.error);
  }, [details.error]);
  if (isDeniedDomainRead(details.error) || readDenied)
    return (
      <QueryState
        error={details.error ?? readDenied}
        retry={async () => {
          const response = await details.refetch();
          if (!response.error) setReadDenied(undefined);
        }}
      />
    );
  return (
    <>
      <Group
        title={connection.title}
        description="Saved status and cached discovery, not a live health check or effective Agent permissions."
      >
        <Row
          title={connection.type === "github" ? "GitHub" : "MCP"}
          description={`${connection.connected ? "Connected" : "Disconnected"} · ${connection.visibility === "user" ? "Only creator" : "Workspace"}`}
          media={
            connection.type === "github" ? (
              <RiGithubFill />
            ) : (
              <RiConnectorLine />
            )
          }
        />
        <QueryState
          pending={details.isPending}
          error={details.error}
          retry={details.refetch}
        />
        {current?.scope?.type === "mcp" && (
          <>
            <Row
              title="Remote authentication"
              description={
                current.scope.authentication === "none"
                  ? "No authentication; deployment opt-in required"
                  : "Bearer; server-bound credential required"
              }
            />
            <Row title="Configured tools">
              <div className="flex max-w-full flex-col gap-1">
                {current.scope.tools.map((tool) => (
                  <span key={tool.name}>
                    {tool.name} · target: {tool.targetArgument} ·{" "}
                    {tool.readOnly ? "Read-only" : "Write-capable"}
                  </span>
                ))}
                {!current.scope.tools.length && (
                  <span>No tools configured</span>
                )}
              </div>
            </Row>
            <Row
              title="Resource URIs and tool targets"
              description="Credential, query and fragment components are omitted. This saved display is not an effective grant or an exact execution target."
            >
              <div className="flex max-w-full flex-col gap-1 break-all">
                {current.scope.resources.map((resource) => (
                  <span key={resource}>{resource}</span>
                ))}
                {!current.scope.resources.length && (
                  <span>No targets configured</span>
                )}
              </div>
            </Row>
          </>
        )}
        {current?.scope?.type === "github" && (
          <>
            <Row
              title="Configured repositories"
              description={
                current.scope.repositories
                  .map((repository) => repository.name)
                  .join(", ") || "No repositories configured"
              }
            />
            <Row
              title="Configured issue permission"
              description={current.scope.permissions.issues || "Not configured"}
            />
          </>
        )}
        {current && !current.scope && (
          <Row
            title="Configuration"
            description="No supported saved configuration"
          />
        )}
        {current && (
          <>
            <Row
              title="Cached discovered actions"
              description={
                current.discovery?.actions.join(", ") || "No saved discovery"
              }
            />
            <Row title="Cached discovered resources">
              <div className="flex max-w-full flex-col gap-1 break-all">
                {current.discovery?.resources.map((resource) => (
                  <span key={resource}>{resource}</span>
                ))}
                {!current.discovery?.resources.length && (
                  <span>No saved resources</span>
                )}
              </div>
            </Row>
          </>
        )}
        {connection.expiresAt && (
          <Row
            title="Provider credential deadline"
            description={`${new Date(connection.expiresAt).toLocaleString()}. This does not guarantee provider acceptance.`}
          />
        )}
        {editable && (
          <Row title="Manage through composer">
            <Button
              variant="outline"
              size="compact"
              onClick={() =>
                ask(
                  `Manage this Connection through exact human-approved requests. Current authorized target: ${JSON.stringify({ connectionId: connection.id, editToken: connection.editToken, title: connection.title, type: connection.type, connected: connection.connected })}. Ask what I want to change. For MCP use request_connection_activate for explicit connect and discovery, never automatic reconnect. GitHub uses the human secure-auth completion step. Preserve unrequested fields and reject stale tokens. Never request credentials in Chat.`,
                )
              }
            >
              Ask agent
            </Button>
          </Row>
        )}
        {editable && connection.type === "github" && (
          <Row
            title="Human authentication completion"
            description="GitHub token issuance keeps its existing reserved expiry. This step does not grant Agent access."
          >
            <Button
              variant="outline"
              size="compact"
              disabled={action.pending}
              onClick={async () => {
                if (
                  await confirm({
                    title: `Complete GitHub authentication: ${connection.title}?`,
                    description:
                      "Authenticate using the existing server-bound GitHub reference and discover its configured repositories. Agent grants remain separate.",
                    action: "Complete authentication",
                  })
                )
                  await action.perform(async () => {
                    await read(
                      await api.connections[":id"].connect.$post({ param }),
                    );
                    await details.refetch();
                  }, "GitHub authentication completed");
              }}
            >
              Complete GitHub authentication
            </Button>
          </Row>
        )}
        {editable &&
          current?.scope &&
          !(
            current.scope.type === "mcp" &&
            current.scope.authentication === "none"
          ) && (
            <Row
              title="Secure completion"
              description="Only an existing deployment-approved credential reference; never enter a key or token."
            >
              <Button
                variant="outline"
                size="compact"
                onClick={() => setCredentials(true)}
              >
                Complete credential reference
              </Button>
            </Row>
          )}
        {editable && connection.connected && (
          <Row title="Availability">
            <Button
              variant="outline"
              size="compact"
              disabled={action.pending}
              onClick={async () => {
                if (
                  await confirm({
                    title: `Disconnect ${connection.title}?`,
                    description:
                      "Otto will block new requests and revoke grants. Existing provider credentials may remain valid until their expiry.",
                    action: "Disconnect",
                    destructive: true,
                  })
                )
                  await action.perform(async () => {
                    const result = await read(
                      await api.connections[":id"].disconnect.$post({ param }),
                    );
                    setExternalExpiry(result.externalCredentialExpiresAt);
                  }, "Connection disconnected");
              }}
            >
              Disconnect
            </Button>
          </Row>
        )}
        <Row title="Human operation approvals">
          <Button
            variant="outline"
            size="compact"
            onClick={() => setOperations((value) => !value)}
          >
            {operations ? "Hide operations" : "Operations"}
          </Button>
        </Row>
        {externalExpiry && (
          <Row
            title="External credential expiry"
            description={`Provider credentials may remain valid until ${new Date(externalExpiry).toLocaleString()}. Otto access is blocked.`}
          />
        )}
        {(action.pending || action.error) && (
          <Row title="Connection update">
            <SaveState {...action} />
          </Row>
        )}
      </Group>
      {credentials && (
        <ConnectionCredentialDialog
          key={connection.id}
          connection={connection}
          open
          onOpenChange={setCredentials}
        />
      )}
      {operations && (
        <ConnectionOperations
          connection={connection}
          onReadDenied={setReadDenied}
        />
      )}
    </>
  );
}
