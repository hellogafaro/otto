import { useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import type { InferResponseType } from "hono/client";
import { useEffect, useState } from "react";
import { isDeniedDomainRead } from "@/components/agents-schedules-mutation-safety";
import { useConfirm } from "@/components/confirm";
import { QueryState } from "@/components/query-state";
import { read, type workspaceApi } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";
import {
  Choice,
  Group,
  Row,
  SaveState,
  SettingsPaging,
  useSettingsAction,
} from "./controls";

type Connection = InferResponseType<
  typeof workspaceApi.connections.$get
>["items"][number];
type Operation = Omit<
  InferResponseType<
    (typeof workspaceApi.connections)[":id"]["operations"]["$get"]
  >["items"][number],
  "arguments"
> & { arguments: unknown };
export function ConnectionOperations({
  connection,
  onReadDenied,
}: {
  connection: Connection;
  onReadDenied: (error: Error) => void;
}) {
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
  useEffect(() => {
    if (query.error && isDeniedDomainRead(query.error))
      onReadDenied(query.error);
  }, [query.error, onReadDenied]);
  return (
    <Group
      title={`${connection.title} operations`}
      description="Only operations sponsored by you are returned. Unknown external outcomes require reconciliation outside Otto."
    >
      <Row title="Filter">
        <div className="flex flex-wrap items-center gap-2">
          <Choice
            label="Operation state"
            value={state}
            options={{
              all: "All states",
              awaiting_approval: "Needs approval",
              approved: "Approved",
              denied: "Denied",
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
        </div>
      </Row>
      <QueryState
        pending={query.isPending}
        error={query.error}
        retry={query.refetch}
      />
      {query.data && !query.error && (
        <>
          {!query.data.items.length && (
            <Row
              title="No operations"
              description="Operations your agents request show up here."
            />
          )}
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
          <div className="flex flex-wrap gap-2">
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
            <Button
              variant="outline"
              size="compact"
              disabled={action.pending || expired || !writable}
              onClick={async () => {
                const yes = await confirm({
                  title: "Deny this exact operation?",
                  description: `${operation.action} on ${operation.target} will not execute. This denial is final; it cannot be retried or approved later.`,
                  action: "Deny",
                });
                if (yes)
                  await action.perform(
                    async () =>
                      read(
                        await api.operations[":id"].deny.$post({
                          param,
                          json: { identity: operation.identity ?? "" },
                        }),
                      ),
                    "Operation denied",
                  );
              }}
            >
              Deny
            </Button>
          </div>
        )}
        {operation.state === "denied" && (
          <p>
            Denied
            {operation.deniedBy
              ? ` by ${directory.actorOf(operation.deniedBy).name} (${operation.deniedBy})`
              : ""}
            {operation.deniedAt
              ? ` · ${new Date(operation.deniedAt).toLocaleString()}`
              : ""}
            . This operation was not executed and cannot be retried.
          </p>
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
