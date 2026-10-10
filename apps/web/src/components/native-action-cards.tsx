import { RiArrowDownSLine } from "@remixicon/react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import type { InferResponseType } from "hono/client";
import { QueryState } from "@/components/query-state";
import { ApiError, read, type workspaceApi } from "@/lib/api";
import { activeRun, type LiveRun } from "@/lib/chat-data";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";

type Action = InferResponseType<
  (typeof workspaceApi.runs)[":runId"]["actions"]["$get"]
>["items"][number];

export function NativeActionCards({
  run,
  canWrite,
}: {
  run: LiveRun;
  canWrite: boolean;
}) {
  const { api, workspaceId, user } = useWorkspace();
  const actions = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "run", run.id, "actions"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.runs[":runId"].actions.$get({
          param: { workspaceId, runId: run.id },
          query: { after: pageParam },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: user.id === run.sponsorId,
    refetchInterval: activeRun(run) ? 2000 : false,
    retry: false,
  });
  if (user.id !== run.sponsorId) return null;
  const items = actions.error
    ? []
    : (actions.data?.pages.flatMap((page) => page.items) ?? []);
  const steps = items.filter((action) => action.status === "approved");
  return (
    <>
      <QueryState
        pending={actions.isPending}
        error={actions.error}
        retry={actions.refetch}
      />
      {steps.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger
            render={<Button variant="ghost" size="compact" />}
          >
            {steps.length} {steps.length === 1 ? "step" : "steps"}
            <RiArrowDownSLine />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col gap-3 py-3">
              {steps.map((action) => (
                <Collapsible key={action.id}>
                  <CollapsibleTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="compact"
                        className="max-w-full"
                      />
                    }
                  >
                    <span className="truncate">
                      {action.type}
                      {"title" in action.input && action.input.title
                        ? ` · ${action.input.title}`
                        : ""}
                    </span>
                    <RiArrowDownSLine />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <NativeActionCard action={action} canResolve={false} />
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
      {items
        .filter((action) => action.status !== "approved")
        .map((action) => (
          <NativeActionCard
            key={action.id}
            action={action}
            canResolve={canWrite && run.state === "running"}
          />
        ))}
      {actions.hasNextPage && (
        <Button
          variant="ghost"
          disabled={actions.isFetchingNextPage}
          onClick={() => actions.fetchNextPage()}
        >
          More actions
        </Button>
      )}
    </>
  );
}

function NativeActionCard({
  action,
  canResolve,
}: {
  action: Action;
  canResolve: boolean;
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const directory = useDirectory();
  const resolve = useMutation({
    mutationFn: async (decision: "approve" | "deny") =>
      read(
        await api.runs[":runId"].actions[":actionId"].resolve.$post({
          param: { workspaceId, runId: action.runId, actionId: action.id },
          json: { decision, digest: action.digest },
        }),
      ),
    onSuccess: () => invalidate(),
    retry: false,
  });
  const receipt = resolve.data ?? action;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{action.type}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p>
          Proposed by agent {directory.actorOf(action.proposedByAgentId).name} (
          {action.proposedByAgentId}). Approval uses your authenticated human
          account and current permissions.
        </p>
        <p>Exact payload and any required target versions:</p>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all">
          {JSON.stringify(action.input, null, 2)}
        </pre>
        <details>
          <summary>Request identity</summary>
          <dl className="break-all">
            <dt>Run</dt>
            <dd>{action.runId}</dd>
            <dt>Tool call</dt>
            <dd>{action.toolCallId}</dd>
            <dt>Digest</dt>
            <dd>{action.digest}</dd>
          </dl>
        </details>
        <p role="status">
          {resolve.isPending
            ? resolve.variables === "approve"
              ? "Submitting approval; execution is not yet confirmed."
              : "Submitting denial; the decision is not yet confirmed."
            : receipt.status === "pending"
              ? canResolve
                ? "Awaiting your decision. No action has been approved."
                : "Not approved. This Run or your current access does not allow execution."
              : receipt.status === "denied"
                ? "Denied. This proposal was not executed."
                : "Approved. The server recorded the action result."}
        </p>
        {receipt.resolvedBy && (
          <p>
            Decision by {directory.actorOf(receipt.resolvedBy).name} (
            {receipt.resolvedBy})
            {receipt.resolvedAt &&
              ` · ${new Date(receipt.resolvedAt).toLocaleString()}`}
          </p>
        )}
        {receipt.result && (
          <pre className="overflow-auto whitespace-pre-wrap break-all">
            {JSON.stringify(receipt.result, null, 2)}
          </pre>
        )}
        {resolve.data?.continuation && (
          <p role="status">
            {resolve.data.continuation.status === "sent"
              ? "Changes were sent to the existing work chat."
              : resolve.data.continuation.message}
          </p>
        )}
        {receipt.status === "approved" &&
          action.input.type === "task.review" &&
          action.input.decision === "request_changes" && (
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: action.input.id }}
                />
              }
            >
              Check worker delivery or retry
            </Button>
          )}
        {resolve.error && (
          <p role="alert">
            {resolve.error instanceof ApiError && resolve.error.status === 409
              ? "This request or its target changed. Reload and review the current proposal before deciding."
              : resolve.error.message}{" "}
            No successful decision was acknowledged.
          </p>
        )}
      </CardContent>
      {receipt.status === "pending" && canResolve && (
        <CardFooter className="gap-2">
          <Button
            disabled={resolve.isPending}
            onClick={() => resolve.mutate("approve")}
          >
            Approve exact action
          </Button>
          <Button
            variant="outline"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate("deny")}
          >
            Deny
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
