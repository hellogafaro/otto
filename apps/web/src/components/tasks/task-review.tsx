import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import { Textarea } from "@workspace/ui/components/textarea";
import { useEffect, useState } from "react";
import { MentionText } from "@/components/mentions";
import { QueryState } from "@/components/query-state";
import { ApiError, read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import type { Task } from "@/lib/task-data";
import { useWorkspace } from "@/lib/workspace";

type Decision = {
  requestId: string;
  editToken: number;
  decision: "approve" | "request_changes";
  body?: string;
};

export function TaskReview({
  task,
  canWrite,
}: {
  task: Task;
  canWrite: boolean;
}) {
  const { api, workspaceId, workspace, user, invalidate } = useWorkspace();
  const directory = useDirectory();
  const [body, setBody] = useState("");
  const [request, setRequest] = useState<Decision>();
  const [deliveryError, setDeliveryError] = useState<string>();
  const review = useQuery({
    queryKey: ["workspace", workspaceId, "task-review", task.id],
    queryFn: async ({ signal }) =>
      read(
        await api.tasks[":id"].review.$get(
          { param: { workspaceId, id: task.id } },
          { init: { signal } },
        ),
      ),
    retry: false,
  });
  useEffect(() => {
    if (
      review.data?.decisionRequest &&
      (review.data.continuationStatus === "pending" ||
        review.data.continuationStatus === "unavailable")
    ) {
      setRequest(review.data.decisionRequest);
      setDeliveryError(
        review.data.continuationStatus === "pending"
          ? "Delivery to the existing work chat is not yet confirmed."
          : "Check the linked Chat and the worker's access or model account, then retry.",
      );
    } else if (
      review.data?.continuationStatus === "sent" ||
      (task.status === "review" && !review.data?.decisionRequest)
    ) {
      setRequest(undefined);
      setDeliveryError(undefined);
    }
  }, [review.data, task.status]);
  const decide = useMutation({
    mutationFn: async (input: Decision) =>
      read(
        await api.tasks[":id"].review.$post({
          param: { workspaceId, id: task.id },
          json: input,
        }),
      ),
    onSuccess: async (result) => {
      if (result.continuation?.status === "unavailable") {
        setDeliveryError(result.continuation.message);
      } else {
        setRequest(undefined);
        setBody("");
        setDeliveryError(undefined);
      }
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500)
        setRequest(undefined);
    },
  });
  const submit = (decision: Decision["decision"]) => {
    const input = {
      requestId: crypto.randomUUID(),
      editToken: task.editToken,
      decision,
      ...(decision === "request_changes" ? { body: body.trim() } : {}),
    };
    setRequest(input);
    setDeliveryError(undefined);
    decide.mutate(input);
  };
  if (task.status !== "review" && !request) return null;
  const canReview =
    canWrite &&
    (task.ownerId === user.id ||
      workspace.role === "owner" ||
      workspace.role === "admin");
  return (
    <Card aria-label="Task review">
      <CardHeader>
        <CardTitle>
          {task.status === "review"
            ? "In review"
            : request?.decision === "request_changes"
              ? "Changes requested"
              : "Review decision"}
        </CardTitle>
        <CardDescription>
          {review.data?.agentId
            ? directory.actorOf(review.data.agentId).name
            : "A contributor"}{" "}
          submitted this work for a human decision.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <QueryState
          pending={review.isPending}
          error={review.error ?? decide.error}
          retry={() => {
            void review.refetch();
          }}
        />
        {review.data && (
          <>
            <div className="whitespace-pre-wrap">
              <MentionText text={review.data.comment.body} />
            </div>
            {review.data.chatId && (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    to="/chats/$chatId"
                    params={{ chatId: review.data.chatId }}
                  />
                }
              >
                Open work chat
              </Button>
            )}
            {canReview && task.status === "review" && (
              <>
                <Field>
                  <FieldLabel htmlFor={`task-review-${task.id}`}>
                    Requested changes
                  </FieldLabel>
                  <Textarea
                    id={`task-review-${task.id}`}
                    value={body}
                    disabled={decide.isPending || Boolean(request)}
                    maxLength={9800}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder="Explain what needs to change before approval."
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    disabled={decide.isPending || Boolean(request)}
                    onClick={() => submit("approve")}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      decide.isPending ||
                      Boolean(request) ||
                      !body.trim() ||
                      new TextEncoder().encode(body.trim()).length > 9800
                    }
                    onClick={() => submit("request_changes")}
                  >
                    Request changes
                  </Button>
                </div>
              </>
            )}
          </>
        )}
        {deliveryError && (
          <p role="alert" className="text-sm text-muted-foreground">
            {review.data?.continuationStatus === "pending"
              ? "Changes were saved; worker notification is not confirmed."
              : "Changes were saved, but the worker was not notified."}{" "}
            {deliveryError}
          </p>
        )}
        {request && (decide.isError || deliveryError) && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {deliveryError
                ? "Retry delivery to the same work chat without repeating the decision."
                : "The decision may have been saved. Retry the same request to confirm it without repeating the decision."}
            </p>
            <Button
              variant="outline"
              disabled={decide.isPending}
              onClick={() => decide.mutate(request)}
            >
              Retry decision
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
