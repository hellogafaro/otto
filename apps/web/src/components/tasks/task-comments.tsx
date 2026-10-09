import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Textarea } from "@workspace/ui/components/textarea";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { Timeline, TimelineItem } from "@/components/activity";
import { Composer } from "@/components/composer";
import { MentionText } from "@/components/mentions";
import { QueryState } from "@/components/query-state";
import { ActorAvatar, shortDate } from "@/components/task-meta";
import { ApiError, read, type workspaceApi } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import type { Task } from "@/lib/task-data";
import { useWorkspace } from "@/lib/workspace";

type TaskComment = InferResponseType<
  (typeof workspaceApi)["task-comments"]["$get"]
>["items"][number];

export function TaskComments({
  task,
  canWrite,
}: {
  task: Task;
  canWrite: boolean;
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const [uncertain, setUncertain] = useState(false);
  const comments = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "task-comments", task.id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      read(
        await api["task-comments"].$get(
          {
            param: { workspaceId },
            query: {
              taskId: task.id,
              sort: "createdAt",
              limit: "100",
              after: pageParam,
            },
          },
          { init: { signal } },
        ),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });
  const create = useMutation({
    mutationFn: async (body: string) => {
      if (!body.trim() || new TextEncoder().encode(body).length > 10000)
        throw new ApiError(400, "invalid");
      return read(
        await api["task-comments"].$post({
          param: { workspaceId },
          json: { taskId: task.id, body },
        }),
      );
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.status >= 500)
        setUncertain(true);
    },
    onSuccess: () => invalidate(),
  });
  const items = comments.error
    ? []
    : (comments.data?.pages.flatMap((page) => page.items) ?? []);
  return (
    <section className="flex flex-col gap-5" aria-label="Task activity">
      <h2 className="text-base font-medium">Activity</h2>
      <QueryState
        pending={comments.isPending}
        error={comments.error}
        retry={comments.refetch}
      />
      {!comments.error && !comments.isPending && (
        <Timeline>
          {task.createdAt && (
            <TimelineItem dot="event" className="text-sm text-muted-foreground">
              Task created · {shortDate.format(new Date(task.createdAt))}
            </TimelineItem>
          )}
          {!items.length && (
            <TimelineItem>
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No comments</EmptyTitle>
                  <EmptyDescription>
                    Comments on this task show up here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </TimelineItem>
          )}
          {items.map((comment) => (
            <TimelineItem key={comment.id}>
              <TaskCommentItem comment={comment} canWrite={canWrite} />
            </TimelineItem>
          ))}
          {comments.hasNextPage && (
            <TimelineItem>
              <Button
                variant="outline"
                disabled={comments.isFetchingNextPage}
                onClick={() => comments.fetchNextPage()}
              >
                Load more comments
              </Button>
            </TimelineItem>
          )}
          {canWrite && (
            <TimelineItem>
              <Composer
                placeholder="Add a comment"
                projectId={task.projectId}
                disabled={uncertain}
                pending={create.isPending}
                onSend={(body) => create.mutateAsync(body)}
              />
            </TimelineItem>
          )}
        </Timeline>
      )}
      <QueryState error={create.error} />
      {uncertain && (
        <p role="alert" className="text-muted-foreground">
          Your comment may have been saved. Reload this task and check its
          comments before sending again.
        </p>
      )}
    </section>
  );
}

function TaskCommentItem({
  comment,
  canWrite,
}: {
  comment: TaskComment;
  canWrite: boolean;
}) {
  const { api, workspaceId, user, invalidate } = useWorkspace();
  const directory = useDirectory();
  const [draft, setDraft] = useState<string>();
  const mutation = useMutation({
    mutationFn: async (action: "save" | "delete") =>
      action === "delete"
        ? read(
            await api["task-comments"][":id"].$delete({
              param: { workspaceId, id: comment.id },
            }),
          )
        : read(
            await api["task-comments"][":id"].$patch({
              param: { workspaceId, id: comment.id },
              json: { body: draft ?? comment.body },
            }),
          ),
    onSuccess: async () => {
      setDraft(undefined);
      await invalidate();
    },
  });
  const human =
    comment.createdBy === user.id
      ? "You"
      : directory.actorOf(comment.createdBy).name;
  const agent = comment.agentId
    ? (directory.agents.find((item) => item.id === comment.agentId)?.title ??
      "Unavailable agent")
    : null;
  const canEdit = canWrite && comment.createdBy === user.id && !comment.agentId;
  const validDraft =
    draft !== undefined &&
    !!draft.trim() &&
    new TextEncoder().encode(draft).length <= 10000;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <ActorAvatar actorId={comment.agentId ?? comment.createdBy} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle title={comment.agentId ?? comment.createdBy}>
              {agent ?? human}
            </CardTitle>
            <CardDescription>
              {agent && (
                <span title={comment.createdBy}>Requested by {human} · </span>
              )}
              <time dateTime={comment.createdAt}>
                {new Date(comment.createdAt).toLocaleString("en", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
              {comment.updatedAt !== comment.createdAt && " · Edited"}
            </CardDescription>
          </div>
          {canEdit && draft === undefined && (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => {
                  mutation.reset();
                  setDraft(comment.body);
                }}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate("delete")}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {draft === undefined || !canEdit ? (
          <p className="whitespace-pre-wrap wrap-anywhere">
            <MentionText text={comment.body} />
          </p>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (validDraft) mutation.mutate("save");
            }}
          >
            <FieldGroup>
              <Field data-invalid={!validDraft}>
                <FieldLabel htmlFor={`comment-${comment.id}`}>
                  Comment
                </FieldLabel>
                <Textarea
                  id={`comment-${comment.id}`}
                  value={draft}
                  maxLength={10000}
                  aria-invalid={!validDraft}
                  disabled={mutation.isPending}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </Field>
            </FieldGroup>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={!validDraft || mutation.isPending}
              >
                {mutation.isPending ? "Saving" : "Save comment"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => {
                  setDraft(undefined);
                  mutation.reset();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
        <QueryState error={mutation.error} />
      </CardContent>
    </Card>
  );
}
