import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxSearch,
  ComboboxTrigger,
} from "@workspace/ui/components/combobox";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import type { InferRequestType, InferResponseType } from "hono/client";
import { QueryState } from "@/components/query-state";
import { read, type workspaceApi } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useProjectMembership } from "@/lib/project-membership";
import { useWorkspace } from "@/lib/workspace";

export type DocumentRecord = InferResponseType<
  (typeof workspaceApi.documents)[":id"]["$get"]
>;
export type DocumentSummary = InferResponseType<
  typeof workspaceApi.documents.$get
>["items"][number];
export type DocumentQuery = InferRequestType<
  typeof workspaceApi.documents.$get
>["query"];
export type CollectionRecord = InferResponseType<
  (typeof workspaceApi.collections)[":id"]["$get"]
>;
export type CollectionField = CollectionRecord["fields"][number];

export function useDocument(id: string) {
  const { api, workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["workspace", workspaceId, "document", id],
    queryFn: async () =>
      read(await api.documents[":id"].$get({ param: { workspaceId, id } })),
    retry: false,
  });
}

export function useDocumentWriter(projectId?: string | null) {
  const { api, workspaceId, workspace } = useWorkspace();
  const membership = useProjectMembership(projectId);
  const directory = useDirectory();
  const members = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "document-project-members", projectId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.projects[":id"].members.$get({
          param: { workspaceId, id: projectId ?? "" },
          query: { limit: "100", sort: "name", after: pageParam },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: Boolean(projectId),
  });
  return {
    directory,
    canWrite: Boolean(
      workspace.role !== "viewer" &&
        (!projectId ||
          (!membership.error && membership.data?.role === "contributor")),
    ),
    members,
    membership,
  };
}

export function DocumentChoice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { id: string; title: string }[];
  onChange(value: string): void;
  disabled?: boolean;
}) {
  const choices = options.some((item) => item.id === value)
    ? options
    : [{ id: value, title: "Unavailable selection" }, ...options];
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Combobox
        disabled={disabled}
        items={choices.map((item) => item.id)}
        value={value}
        onValueChange={(next) => !disabled && next !== null && onChange(next)}
        itemToStringLabel={(id) =>
          choices.find((item) => item.id === id)?.title ??
          "Unavailable selection"
        }
      >
        <ComboboxTrigger
          disabled={disabled}
          render={
            <Button
              variant="outline"
              className="justify-between"
              aria-label={label}
            />
          }
        >
          {choices.find((item) => item.id === value)?.title}
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxSearch placeholder={`Search ${label.toLowerCase()}`} />
          <ComboboxEmpty>No matches</ComboboxEmpty>
          <ComboboxList>
            {(id: string) => (
              <ComboboxItem value={id} key={id}>
                {choices.find((item) => item.id === id)?.title}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}

export function FolderChoice({
  projectId,
  visibility,
  value,
  onChange,
  disabled,
}: {
  projectId: string | null;
  visibility: "user" | "workspace";
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}) {
  const { api, workspaceId, user } = useWorkspace();
  const folders = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "document-folders", projectId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.folders.$get({
          param: { workspaceId },
          query: {
            limit: "100",
            sort: "title",
            after: pageParam,
            projectId: projectId ?? undefined,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const options =
    folders.data?.pages
      .flatMap((page) => page.items)
      .filter(
        (item) =>
          item.projectId === projectId &&
          (item.visibility === "workspace" ||
            (visibility === "user" && item.createdBy === user.id)),
      )
      .map((item) => ({ id: item.id, title: item.title })) ?? [];
  return (
    <>
      <DocumentChoice
        label="Folder"
        value={value}
        options={[{ id: "", title: "Top level" }, ...options]}
        onChange={onChange}
        disabled={disabled || folders.isPending || Boolean(folders.error)}
      />
      <QueryState error={folders.error} retry={() => folders.refetch()} />
      {folders.hasNextPage && (
        <Button
          variant="ghost"
          disabled={folders.isFetchingNextPage}
          onClick={() => folders.fetchNextPage()}
        >
          Load more folders
        </Button>
      )}
    </>
  );
}

export function parseDocumentLabels(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}
export function documentInputError(
  title: string,
  body: string,
  labels: string[],
) {
  if (!title.trim() || title.trim().length > 200)
    return "Use a title between 1 and 200 characters.";
  if (new TextEncoder().encode(body).length > 100000)
    return "The document must be at most 100,000 bytes.";
  if (labels.length > 30 || labels.some((label) => label.length > 200))
    return "Use at most 30 labels, each at most 200 characters.";
  return null;
}

export function DocumentFolder({
  folderId,
  projectId,
}: {
  folderId: string | null;
  projectId: string | null;
}) {
  const { api, workspaceId } = useWorkspace();
  const folder = useQuery({
    queryKey: ["workspace", workspaceId, "folder", folderId],
    queryFn: async () =>
      read(
        await api.folders[":id"].$get({
          param: { workspaceId, id: folderId ?? "" },
        }),
      ),
    enabled: Boolean(folderId),
    retry: false,
  });
  return (
    <Field>
      <FieldLabel>Folder</FieldLabel>
      {folderId ? (
        <>
          <Link
            to="/library"
            search={{ folder: folderId, project: projectId ?? undefined }}
          >
            {folder.data?.path.map((item) => item.title).join(" / ") ||
              "Open folder"}
          </Link>
          <QueryState
            pending={folder.isPending}
            error={folder.error}
            retry={() => folder.refetch()}
          />
        </>
      ) : (
        <p>Top level</p>
      )}
    </Field>
  );
}

export function DocumentDirectoryPages({
  members = false,
  agents = false,
  projects = false,
}: {
  members?: boolean;
  agents?: boolean;
  projects?: boolean;
}) {
  const directory = useDirectory();
  const lists = [
    { show: members, query: directory.membersQuery, title: "people" },
    { show: agents, query: directory.agentsQuery, title: "agents" },
    { show: projects, query: directory.projectsQuery, title: "projects" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {lists.map(
        ({ show, query, title }) =>
          show &&
          query.hasNextPage && (
            <Button
              key={title}
              type="button"
              variant="ghost"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              Load more {title}
            </Button>
          ),
      )}
    </div>
  );
}
