import { useInfiniteQuery } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { read, type workspaceApi } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export type Task = InferResponseType<
  (typeof workspaceApi.tasks)[":id"]["$get"]
>;
export type TaskUpdate = InferRequestType<
  (typeof workspaceApi.tasks)[":id"]["$patch"]
>["json"];
export type TaskCreate = InferRequestType<
  (typeof workspaceApi.tasks)["$post"]
>["json"];
export type TaskLink = InferResponseType<
  (typeof workspaceApi.tasks)[":id"]["links"]["$get"]
>["items"][number];
export type Timesheet = InferResponseType<
  (typeof workspaceApi.timesheets)["$get"]
>["items"][number];
export const taskStatusOrder = ["todo", "doing", "done"] as const;
export const taskSorts = ["title", "createdAt", "updatedAt", "dueAt"] as const;

/** Project membership is separate from workspace membership. Missing/loading authority never enables writes. */
export function useTaskProject(projectId: string | undefined) {
  const { api, workspaceId, workspace, user } = useWorkspace();
  const query = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "task-project-members", projectId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      read(
        await api.projects[":id"].members.$get(
          {
            param: { workspaceId, id: projectId ?? "" },
            query: { limit: "100", sort: "name", after: pageParam },
          },
          { init: { signal } },
        ),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: Boolean(projectId),
    retry: false,
  });
  const members = query.data?.pages.flatMap((page) => page.items) ?? [];
  return {
    query,
    members,
    canWrite:
      !query.error &&
      workspace.role !== "viewer" &&
      members.some(
        (member) => member.userId === user.id && member.role === "contributor",
      ),
  };
}

/** Preserve local wall-clock input while crossing HTTP with an explicit offset. */
export function taskDueInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export type TasksSearch = {
  owner?: string;
  assignee?: string;
  project?: string;
  query?: string;
  status?: Task["status"];
  archived?: "true" | "false";
  sort?: (typeof taskSorts)[number];
  order?: "asc" | "desc";
  after?: string;
  limit?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateTasksSearch(
  search: Record<string, unknown>,
): TasksSearch {
  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.length > 0 && value.length <= max
      ? value
      : undefined;
  const sort = taskSorts.find((value) => search.sort === value);
  const limit = Number(search.limit);
  return {
    owner: text(search.owner, 128),
    assignee:
      typeof search.assignee === "string" &&
      (search.assignee === "me" ||
        /^user:.{1,128}$/.test(search.assignee) ||
        (search.assignee.startsWith("agent:") &&
          uuid.test(search.assignee.slice(6))))
        ? search.assignee
        : undefined,
    project:
      typeof search.project === "string" && uuid.test(search.project)
        ? search.project
        : undefined,
    query: text(search.query, 200),
    status: taskStatusOrder.find((value) => search.status === value),
    archived: search.archived === "true" ? "true" : undefined,
    sort,
    order:
      sort && (search.order === "asc" || search.order === "desc")
        ? search.order
        : undefined,
    after: text(search.after, 4096),
    limit:
      Number.isInteger(limit) && limit >= 1 && limit <= 100
        ? String(limit)
        : undefined,
  };
}
