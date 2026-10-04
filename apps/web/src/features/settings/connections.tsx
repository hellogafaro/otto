import { RiGithubFill } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import type { InferResponseType } from "hono/client";
import { useId, useState } from "react";
import { useConfirm } from "@/components/confirm";
import { RiConnectorLine } from "@/components/icons";
import { QueryState } from "@/components/query-state";
import { read, type workspaceApi } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";
import { ConnectionConfigDialog, positiveId } from "./connection-config";
import {
  Choice,
  Group,
  Row,
  SaveState,
  SettingsDialog,
  SettingsField,
  SettingsFilters,
  SettingsInput,
  SettingsPaging,
  useSettingsAction,
  useSettingsCreation,
  useSettingsList,
} from "./controls";
import {
  type GrantAgent,
  GrantAgentButton,
  GrantAgents,
  GrantMembers,
} from "./grant-directory";

type Connection = InferResponseType<
  typeof workspaceApi.connections.$get
>["items"][number];
type Discovery = InferResponseType<
  (typeof workspaceApi.connections)[":id"]["discover"]["$post"]
>;
type Operation = Omit<
  InferResponseType<
    (typeof workspaceApi.connections)[":id"]["operations"]["$get"]
  >["items"][number],
  "arguments"
> & { arguments: unknown };
const sorts = { title: "Name", createdAt: "Created", updatedAt: "Updated" };
const visibilityOptions = { user: "Only you", workspace: "Workspace" };
export function ConnectionSettings() {
  const { api, workspaceId } = useWorkspace();
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
    enabled: Boolean(id),
  });
  const type = (["github", "mcp"] as const).find(
    (value) => value === list.params.get("type"),
  );
  const visibility = (["user", "workspace"] as const).find(
    (value) => value === list.params.get("visibility"),
  );
  const connected =
    list.params.get("connected") === "true"
      ? "true"
      : list.params.get("connected") === "false"
        ? "false"
        : undefined;
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
          <ConnectionCard key={selected.data.id} connection={selected.data} />
        )}
      </>
    );
  return (
    <>
      <SettingsFilters>
        <Choice
          label="Connection type"
          value={type ?? "all"}
          options={{ all: "All types", github: "GitHub", mcp: "MCP" }}
          onChange={(type) =>
            list.update({ type: type === "all" ? undefined : type })
          }
        />
        <Choice
          label="Connection visibility"
          value={visibility ?? "all"}
          options={{ all: "All connections", ...visibilityOptions }}
          onChange={(visibility) =>
            list.update({
              visibility: visibility === "all" ? undefined : visibility,
            })
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
          onChange={(connected) =>
            list.update({
              connected: connected === "all" ? undefined : connected,
            })
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
          {query.data.items.map((connection) => (
            <ConnectionCard key={connection.id} connection={connection} />
          ))}
          {!query.data.items.length && (
            <Group>
              <Row
                title="No connections match"
                description="Create a GitHub or MCP connection, or change the filters."
              />
            </Group>
          )}
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
export function NewConnection({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { api, workspaceId } = useWorkspace();
  const router = useRouter();
  const action = useSettingsCreation();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"github" | "mcp">("github");
  const [visibility, setVisibility] = useState<"user" | "workspace">("user");
  const [accountRef, setAccountRef] = useState("");
  const [accountId, setAccountId] = useState("");
  const [installationId, setInstallationId] = useState("");
  return (
    <SettingsDialog
      title="New connection"
      description="Create the association, then configure a server credential reference and explicit provider scope. Never enter keys or tokens."
      open={open}
      onOpenChange={onOpenChange}
      pending={action.pending}
      error={action.error}
      submitDisabled={action.blocked}
      onSubmit={async () => {
        if (
          await action.perform(async () => {
            const reference =
              type === "github"
                ? `github:${positiveId(accountId)}:${positiveId(installationId)}`
                : accountRef.trim();
            if (!/^[\w.:-]{1,200}$/.test(reference))
              throw new Error(
                "Enter an account association identifier without credentials.",
              );
            const connection = await action.create(() =>
              api.connections.$post({
                param: { workspaceId },
                json: {
                  title: title.trim(),
                  type,
                  accountRef: reference,
                  visibility,
                },
              }),
            );
            if (!action.isActive()) return;
            router.history.push(
              `/settings/connections?connection=${encodeURIComponent(connection.id)}`,
            );
          }, "Connection created")
        ) {
          action.reset();
          setTitle("");
          setAccountRef("");
          setAccountId("");
          setInstallationId("");
          onOpenChange(false);
        }
      }}
    >
      <SettingsField
        label="Name"
        required
        maxLength={200}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Field>
        <FieldLabel>Type</FieldLabel>
        <Choice
          label="Connection type"
          value={type}
          options={{ github: "GitHub App", mcp: "MCP server" }}
          onChange={setType}
        />
      </Field>
      {type === "github" ? (
        <>
          <SettingsField
            label="GitHub account ID"
            required
            inputMode="numeric"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          />
          <SettingsField
            label="Installation ID"
            required
            inputMode="numeric"
            value={installationId}
            onChange={(event) => setInstallationId(event.target.value)}
          />
        </>
      ) : (
        <SettingsField
          label="Account association"
          description="A non-secret identifier for the external MCP account."
          required
          value={accountRef}
          maxLength={200}
          autoComplete="off"
          onChange={(event) => setAccountRef(event.target.value)}
        />
      )}
      <Field>
        <FieldLabel>Who can use it</FieldLabel>
        <Choice
          label="Connection visibility"
          value={visibility}
          options={visibilityOptions}
          onChange={setVisibility}
        />
      </Field>
    </SettingsDialog>
  );
}
function ConnectionCard({ connection }: { connection: Connection }) {
  const { api, workspaceId, user, workspace, invalidate } = useWorkspace();
  const action = useSettingsAction();
  const confirm = useConfirm();
  const [configOpen, setConfigOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [discovered, setDiscovered] = useState<{
    editToken: number;
    data: Discovery;
  } | null>(null);
  const discovery =
    connection.connected && discovered?.editToken === connection.editToken
      ? discovered.data
      : null;
  const [showOperations, setShowOperations] = useState(false);
  const [externalExpiry, setExternalExpiry] = useState<string | null>(null);
  const editable =
    connection.createdBy === user.id && workspace.role !== "viewer";
  const param = { workspaceId, id: connection.id };
  return (
    <>
      <Group title={connection.title}>
        <Row
          title={connection.type === "github" ? "GitHub" : "MCP"}
          description={`${connection.connected ? "Connected" : "Disconnected"} · ${connection.visibility === "user" ? "Only creator" : "Workspace"}`}
          media={
            connection.type === "github" ? (
              <RiGithubFill className="size-5" />
            ) : (
              <RiConnectorLine className="size-5" />
            )
          }
        >
          <div className="flex flex-wrap gap-2">
            {editable && (
              <>
                <Button
                  variant="outline"
                  size="compact"
                  disabled={action.pending}
                  onClick={() => setConfigOpen(true)}
                >
                  Configure
                </Button>
                <Button
                  variant="outline"
                  size="compact"
                  disabled={action.pending}
                  onClick={() =>
                    action.perform(async () => {
                      await read(
                        await api.connections[":id"].connect.$post({ param }),
                      );
                      setExternalExpiry(null);
                    }, "Connection confirmed")
                  }
                >
                  {connection.connected ? "Reconnect" : "Connect"}
                </Button>
                <Button
                  variant="outline"
                  size="compact"
                  disabled={action.pending}
                  onClick={() =>
                    action.perform(async () => {
                      setGrantOpen(false);
                      setDiscovered({
                        editToken: connection.editToken,
                        data: await read(
                          await api.connections[":id"].discover.$post({
                            param,
                          }),
                        ),
                      });
                    }, "Discovery updated")
                  }
                >
                  Discover
                </Button>
                {connection.connected && (
                  <Button
                    variant="outline"
                    size="compact"
                    disabled={action.pending}
                    onClick={async () => {
                      const yes = await confirm({
                        title: `Disconnect ${connection.title}?`,
                        description:
                          "Otto will block requests and revoke grants. Existing GitHub tokens may remain valid until their expiry.",
                        action: "Disconnect",
                        destructive: true,
                      });
                      if (yes)
                        await action.perform(async () => {
                          const result = await read(
                            await api.connections[":id"].disconnect.$post({
                              param,
                            }),
                          );
                          setExternalExpiry(result.externalCredentialExpiresAt);
                        }, "Connection disconnected");
                    }}
                  >
                    Disconnect
                  </Button>
                )}
              </>
            )}
            <Button
              variant="outline"
              size="compact"
              onClick={() => setShowOperations((value) => !value)}
            >
              {showOperations ? "Hide operations" : "Operations"}
            </Button>
          </div>
        </Row>
        {editable && (
          <>
            <Row title="Name">
              <SettingsInput
                label={`${connection.title} name`}
                initial={connection.title}
                disabled={action.pending}
                save={async (title) => {
                  await read(
                    await api.connections[":id"].$patch({
                      param,
                      json: { title: title.trim() },
                    }),
                  );
                  await invalidate();
                }}
              />
            </Row>
            <Row
              title="Who can use this connection"
              description="Changing visibility revokes existing grants and pending approvals."
            >
              <Choice
                label={`${connection.title} visibility`}
                value={connection.visibility}
                options={visibilityOptions}
                disabled={action.pending}
                onChange={async (visibility) => {
                  if (visibility === connection.visibility) return;
                  const yes = await confirm({
                    title: "Change connection visibility?",
                    description:
                      "Existing grants and pending approvals will be invalidated.",
                    action: "Change visibility",
                  });
                  if (yes)
                    await action.perform(
                      async () =>
                        read(
                          await api.connections[":id"].$patch({
                            param,
                            json: {
                              visibility,
                              editToken: connection.editToken,
                            },
                          }),
                        ),
                      "Connection visibility saved",
                    );
                }}
              />
            </Row>
            <Row
              title="Agent access"
              description="Existing grants cannot be listed here. Discover before creating or replacing an exact scoped grant."
            >
              <Button
                variant="outline"
                size="compact"
                disabled={action.pending || !connection.connected || !discovery}
                onClick={() => setGrantOpen(true)}
              >
                Grant access
              </Button>
            </Row>
            <RevokeGrant connection={connection} />
          </>
        )}
        {(action.pending || action.error) && (
          <Row title="Connection update">
            <SaveState {...action} />
          </Row>
        )}
        {externalExpiry && (
          <Row
            title="External credential expiry"
            description={`Provider-side credentials may remain valid until ${new Date(externalExpiry).toLocaleString()}. Otto access is blocked.`}
          />
        )}
        {connection.expiresAt && (
          <Row
            title="Provider credential deadline"
            description={`${new Date(connection.expiresAt).toLocaleString()}. This does not guarantee provider acceptance.`}
          />
        )}
        {discovery && (
          <>
            <Row
              title="Discovered actions"
              description={
                discovery.actions.length
                  ? discovery.actions.join(", ")
                  : "No actions discovered"
              }
            />
            <Row title="Discovered resources">
              <div className="flex max-w-full flex-col gap-1 break-all">
                {discovery.resources.length ? (
                  discovery.resources.map((resource) => (
                    <span key={resource}>{resource}</span>
                  ))
                ) : (
                  <span>No resources discovered</span>
                )}
              </div>
            </Row>
          </>
        )}
      </Group>
      {editable && configOpen && (
        <ConnectionConfigDialog
          key={connection.id}
          connection={connection}
          open={configOpen}
          onOpenChange={setConfigOpen}
        />
      )}
      {editable && discovery && (
        <GrantDialog
          key={`${connection.id}:${connection.editToken}`}
          connection={connection}
          discovery={discovery}
          open={grantOpen}
          onOpenChange={setGrantOpen}
        />
      )}
      {showOperations && <ConnectionOperations connection={connection} />}
    </>
  );
}
function Selection({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal">
      <Checkbox
        id={id}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
    </Field>
  );
}
const toggle = (values: string[], value: string, checked: boolean) =>
  checked
    ? [...new Set([...values, value])]
    : values.filter((item) => item !== value);
function GrantDialog({
  connection,
  discovery,
  open,
  onOpenChange,
}: {
  connection: Connection;
  discovery: Discovery;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { api, workspaceId, user } = useWorkspace();
  const action = useSettingsAction();
  const [selectedAgent, setSelectedAgent] = useState<GrantAgent | null>(null);
  const [resources, setResources] = useState<string[]>([]);
  const [operations, setOperations] = useState<
    Record<string, "allowed" | "confirmation" | "disabled">
  >({});
  const [humans, setHumans] = useState<string[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const createdBy = connection.visibility === "user" ? user.id : undefined;
  return (
    <SettingsDialog
      title={`Grant ${connection.title} access`}
      description="Replace this agent's grant with exact discovered resources, actions and an explicitly selected output audience. Nothing is selected automatically."
      open={open}
      onOpenChange={onOpenChange}
      pending={action.pending}
      error={action.error}
      submitLabel="Grant access"
      onSubmit={async () => {
        if (
          await action.perform(async () => {
            if (!selectedAgent)
              throw new Error("Select an eligible current agent.");
            if (
              !resources.length ||
              !Object.values(operations).some((value) => value !== "disabled")
            )
              throw new Error(
                "Select at least one resource and an allowed action.",
              );
            if (!humans.length && !agents.length)
              throw new Error("Select the exact output audience.");
            if (
              humans.length > 500 ||
              agents.length > 100 ||
              Object.keys(operations).length > 50
            )
              throw new Error(
                "Select at most 500 humans, 100 agents and 50 actions.",
              );
            await read(
              await api.connections[":id"].grants.$post({
                param: { workspaceId, id: connection.id },
                json: {
                  agentId: selectedAgent.id,
                  resources,
                  operations,
                  audience: { humans, agents },
                },
              }),
            );
          }, "Agent grant saved")
        )
          onOpenChange(false);
      }}
    >
      <Field>
        <FieldLabel>Agent</FieldLabel>
        <span>
          {selectedAgent
            ? `${selectedAgent.title} (${selectedAgent.id})`
            : "Select an agent"}
        </span>
        <GrantAgents
          createdBy={createdBy}
          enabled={open}
          render={(agent) => (
            <GrantAgentButton
              agent={agent}
              selected={selectedAgent}
              onSelect={setSelectedAgent}
            />
          )}
        />
      </Field>
      {discovery.resources.map((resource) => (
        <Selection
          key={resource}
          label={resource}
          checked={resources.includes(resource)}
          onChange={(checked) =>
            setResources((values) => toggle(values, resource, checked))
          }
        />
      ))}
      {discovery.actions.map((action) => (
        <Field key={action}>
          <FieldLabel>{action}</FieldLabel>
          <Choice
            label={`${action} policy`}
            value={operations[action] ?? "disabled"}
            options={{
              disabled: "Disabled",
              confirmation: "Ask each time",
              allowed: "Allowed",
            }}
            onChange={(value) =>
              setOperations((values) => ({ ...values, [action]: value }))
            }
          />
        </Field>
      ))}
      <Field>
        <FieldLabel>
          Human output audience ({humans.length} selected)
        </FieldLabel>
        {connection.visibility === "user" ? (
          <Selection
            label={user.name}
            checked={humans.includes(user.id)}
            onChange={(checked) =>
              setHumans((values) => toggle(values, user.id, checked))
            }
          />
        ) : (
          <GrantMembers
            enabled={open}
            render={(member) => (
              <Selection
                label={`${member.name} (${member.userId})`}
                checked={humans.includes(member.userId)}
                onChange={(checked) =>
                  setHumans((values) => toggle(values, member.userId, checked))
                }
              />
            )}
          />
        )}
      </Field>
      <Field>
        <FieldLabel>
          Agent output audience ({agents.length} selected)
        </FieldLabel>
        <GrantAgents
          createdBy={createdBy}
          enabled={open}
          render={(agent) => (
            <Selection
              label={`${agent.title} (${agent.id})`}
              checked={agents.includes(agent.id)}
              onChange={(checked) =>
                setAgents((values) => toggle(values, agent.id, checked))
              }
            />
          )}
        />
      </Field>
    </SettingsDialog>
  );
}
function RevokeGrant({ connection }: { connection: Connection }) {
  const { api, workspaceId, user } = useWorkspace();
  const action = useSettingsAction();
  const confirm = useConfirm();
  const [selectedAgent, setSelectedAgent] = useState<GrantAgent | null>(null);
  const [choose, setChoose] = useState(false);
  return (
    <Row
      title="Revoke agent access"
      description="This revokes the selected agent's grant; it does not assert a grant currently exists."
    >
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          size="compact"
          disabled={action.pending}
          onClick={() => setChoose((value) => !value)}
        >
          {selectedAgent?.title ?? "Select an agent"}
        </Button>
        {choose && !action.pending && (
          <GrantAgents
            createdBy={connection.visibility === "user" ? user.id : undefined}
            enabled={choose}
            includeArchived
            render={(agent) => (
              <GrantAgentButton
                agent={agent}
                selected={selectedAgent}
                onSelect={(agent) => {
                  setSelectedAgent(agent);
                  setChoose(false);
                }}
              />
            )}
          />
        )}
        <Button
          variant="outline"
          size="compact"
          disabled={!selectedAgent || action.pending}
          onClick={async () => {
            if (!selectedAgent) return;
            const yes = await confirm({
              title: "Revoke agent grant?",
              description: `${selectedAgent.title} (${selectedAgent.id}) and its active runs will lose this connection access.`,
              action: "Revoke",
              destructive: true,
            });
            if (yes)
              await action.perform(
                async () =>
                  read(
                    await api.connections[":id"].grants[":agentId"].$delete({
                      param: {
                        workspaceId,
                        id: connection.id,
                        agentId: selectedAgent.id,
                      },
                    }),
                  ),
                "Agent grant revoked",
              );
          }}
        >
          Revoke
        </Button>
        <SaveState {...action} />
      </div>
    </Row>
  );
}
function ConnectionOperations({ connection }: { connection: Connection }) {
  const { api, workspaceId } = useWorkspace();
  const [after, setAfter] = useState<string>();
  const [state, setState] = useState<"all" | Operation["state"]>("all");
  const [sort, setSort] = useState<"createdAt" | "updatedAt">("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const query = useQuery<{ items: Operation[]; next: string | null }>({
    queryKey: [
      "workspace",
      workspaceId,
      "connections",
      connection.id,
      "operations",
      after,
      state,
      sort,
      order,
    ],
    queryFn: async () =>
      read(
        await api.connections[":id"].operations.$get({
          param: { workspaceId, id: connection.id },
          query: {
            after,
            state: state === "all" ? undefined : state,
            sort,
            order,
            limit: "100",
          },
        }),
      ),
    refetchInterval: 10000,
  });
  return (
    <Group
      title={`${connection.title} operations`}
      description="Only operations sponsored by you are returned. Unknown external outcomes require reconciliation outside Otto."
    >
      <Row title="Filter">
        <Choice
          label="Operation state"
          value={state}
          options={{
            all: "All states",
            awaiting_approval: "Needs approval",
            approved: "Approved",
            executing: "Executing",
            succeeded: "Succeeded",
            failed: "Failed",
            uncertain: "Uncertain",
          }}
          onChange={(state) => {
            setState(state);
            setAfter(undefined);
          }}
        />
        <Choice
          label="Operation sort"
          value={sort}
          options={{ createdAt: "Created", updatedAt: "Updated" }}
          onChange={(sort) => {
            setSort(sort);
            setAfter(undefined);
          }}
        />
        <Choice
          label="Operation order"
          value={order}
          options={{ asc: "Ascending", desc: "Descending" }}
          onChange={(order) => {
            setOrder(order);
            setAfter(undefined);
          }}
        />
      </Row>
      <QueryState
        pending={query.isPending}
        error={query.error}
        retry={query.refetch}
      />
      {query.data && !query.error && (
        <>
          {!query.data.items.length && <Row title="No operations match" />}
          {query.data.items.map((operation) => (
            <OperationRow key={operation.id} operation={operation} />
          ))}
          <SettingsPaging
            next={query.data.next}
            after={after}
            change={setAfter}
          />
        </>
      )}
    </Group>
  );
}
function OperationRow({ operation }: { operation: Operation }) {
  const { api, workspaceId, workspace, invalidate } = useWorkspace();
  const directory = useDirectory();
  const action = useSettingsAction();
  const confirm = useConfirm();
  const expired =
    !operation.expiresAt ||
    new Date(operation.expiresAt).getTime() <= Date.now();
  const writable = workspace.role !== "viewer";
  const param = { workspaceId, id: operation.id };
  return (
    <Row
      title={`${operation.action} · ${operation.state}`}
      description={`${operation.target}${operation.outcome ? ` · ${operation.outcome}` : ""}`}
    >
      <div className="flex max-w-full flex-col items-start gap-2">
        <details>
          <summary>Review exact request</summary>
          <div className="flex flex-col gap-2 break-all">
            <span>Run: {operation.runId}</span>
            <span>Identity: {operation.identity ?? "Unavailable"}</span>
            <span>
              Expires:{" "}
              {operation.expiresAt
                ? new Date(operation.expiresAt).toLocaleString()
                : "Unknown"}
            </span>
            <span>Retries: {operation.retryCount} / 2</span>
            <span>
              Audience:{" "}
              {[
                ...(operation.audience?.humans ?? []),
                ...(operation.audience?.agents ?? []),
              ]
                .map((id) => `${directory.actorOf(id).name} (${id})`)
                .join(", ") || "Unavailable"}
            </span>
            <pre className="max-h-52 max-w-full overflow-auto whitespace-pre-wrap">
              {JSON.stringify(operation.arguments, null, 2)}
            </pre>
          </div>
        </details>
        {operation.state === "awaiting_approval" && operation.identity && (
          <Button
            variant="outline"
            size="compact"
            disabled={action.pending || expired || !writable}
            onClick={async () => {
              const yes = await confirm({
                title: "Approve this exact operation?",
                description: `${operation.action} on ${operation.target}. Review the arguments, audience and identity before approving.`,
                action: "Approve",
              });
              if (yes)
                await action.perform(
                  async () =>
                    read(
                      await api.operations[":id"].approve.$post({
                        param,
                        json: { identity: operation.identity ?? "" },
                      }),
                    ),
                  "Operation approved",
                );
            }}
          >
            Approve
          </Button>
        )}
        {operation.state === "approved" && (
          <Button
            variant="outline"
            size="compact"
            disabled={action.pending || expired || !writable}
            onClick={async () => {
              const yes = await confirm({
                title: "Execute approved operation?",
                description: `The provider will receive this exact ${operation.action} request.`,
                action: "Execute",
              });
              if (yes)
                await action.perform(async () => {
                  const result = await read(
                    await api.operations[":id"].execute.$post({ param }),
                  );
                  await invalidate();
                  if (result.state !== "succeeded")
                    throw new Error(
                      `Operation ${result.state}${result.outcome ? `: ${result.outcome}` : ""}. Reload its status before taking further action.`,
                    );
                }, "Operation succeeded");
            }}
          >
            Execute
          </Button>
        )}
        {operation.state === "failed" && operation.retryCount < 2 && (
          <Button
            variant="outline"
            size="compact"
            disabled={action.pending || expired || !writable}
            onClick={async () => {
              const yes = await confirm({
                title: "Retry failed read?",
                description:
                  "The server permits only failed reads. Writes cannot be retried. A successful retry returns to Approved for explicit execution.",
                action: "Retry read",
              });
              if (yes)
                await action.perform(
                  async () =>
                    read(await api.operations[":id"].retry.$post({ param })),
                  "Read retry approved",
                );
            }}
          >
            Retry read
          </Button>
        )}
        {expired &&
          ["awaiting_approval", "approved", "failed"].includes(
            operation.state,
          ) && <span>Approval expired; request new work from the run.</span>}
        {operation.state === "uncertain" && (
          <p>
            Check the external system before authorizing new work. Otto cannot
            retry or mark this outcome reconciled.
          </p>
        )}
        <SaveState {...action} />
      </div>
    </Row>
  );
}
