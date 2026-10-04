import {
  RiAddLine,
  RiBox3Line,
  RiEyeLine,
  RiFileTextLine,
  RiPriceTag3Line,
  RiQuillPenLine,
  RiUserLine,
} from "@remixicon/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { useEffect, useRef, useState } from "react";
import {
  DocumentChoice,
  DocumentDirectoryPages,
  type DocumentQuery,
  documentInputError,
  FolderChoice,
  parseDocumentLabels,
  useDocument,
  useDocumentWriter,
} from "@/components/documents/document-data";
import { DocumentMenu } from "@/components/documents/document-menu";
import {
  FilterBar,
  type FilterDef,
  FilterMenu,
  labelLooks,
  NoResults,
} from "@/components/filters";
import { Gallery, GalleryItem } from "@/components/gallery";
import { IconAction } from "@/components/icon-action";
import { Page } from "@/components/page";
import { QueryState } from "@/components/query-state";
import type { Look } from "@/components/task-meta";
import { ApiError, read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";

export type DocumentsSearch = {
  createdBy?: string;
  project?: string;
  label?: string;
  visibility?: "user" | "workspace";
  collectionId?: string;
  archived?: "true" | "false";
  query?: string;
  sort?: "title" | "createdAt" | "updatedAt";
  order?: "asc" | "desc";
  after?: string;
  limit?: string;
};
export function validateDocumentsSearch(
  search: Record<string, unknown>,
): DocumentsSearch {
  const text = (key: string, max: number) =>
    typeof search[key] === "string" &&
    search[key].length > 0 &&
    search[key].length <= max
      ? search[key]
      : undefined;
  const uuid = (key: string) => {
    const value = text(key, 36);
    return value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
      ? value
      : undefined;
  };
  const sort = ["title", "createdAt", "updatedAt"].includes(String(search.sort))
    ? (search.sort as DocumentsSearch["sort"])
    : undefined;
  return {
    createdBy: text("createdBy", 128),
    project: uuid("project"),
    label: text("label", 200),
    visibility:
      search.visibility === "user" || search.visibility === "workspace"
        ? search.visibility
        : undefined,
    collectionId: uuid("collectionId"),
    archived:
      search.archived === "true" || search.archived === "false"
        ? search.archived
        : undefined,
    query: text("query", 200),
    sort,
    order:
      sort && (search.order === "asc" || search.order === "desc")
        ? search.order
        : undefined,
    after: text("after", 4096),
    limit:
      /^\d+$/.test(String(search.limit)) &&
      Number(search.limit) >= 1 &&
      Number(search.limit) <= 100
        ? String(Number(search.limit))
        : undefined,
  };
}

export function DocumentsPage({ search }: { search: DocumentsSearch }) {
  const { api, workspaceId, user, workspace } = useWorkspace();
  const navigate = useNavigate({ from: "/documents" });
  const directory = useDirectory();
  const [creating, setCreating] = useState(false);
  const [queryText, setQueryText] = useState(search.query ?? "");
  const [labelText, setLabelText] = useState(search.label ?? "");
  useEffect(() => setQueryText(search.query ?? ""), [search.query]);
  useEffect(() => setLabelText(search.label ?? ""), [search.label]);
  const query: DocumentQuery = {
    projectId: search.project,
    createdBy: search.createdBy === "me" ? user.id : search.createdBy,
    label: search.label,
    visibility: search.visibility,
    collectionId: search.collectionId,
    archived: search.archived,
    query: search.query,
    sort: search.sort ?? "updatedAt",
    order: search.order ?? (search.sort ? "asc" : "desc"),
    after: search.after,
    limit: search.limit ?? "24",
  };
  const list = useQuery({
    queryKey: ["workspace", workspaceId, "documents", query],
    queryFn: async () =>
      read(await api.documents.$get({ param: { workspaceId }, query })),
    retry: false,
  });
  const collections = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "document-collections-filter"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.collections.$get({
          param: { workspaceId },
          query: { limit: "100", sort: "title", after: pageParam },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const change = (key: keyof DocumentsSearch, value: string | undefined) =>
    navigate({
      search: (prev) => ({ ...prev, [key]: value, after: undefined }),
    });
  const clear = () => navigate({ search: {} });
  const people: Record<string, Look> = Object.fromEntries(
    directory.members.map((item) => [
      item.userId,
      { label: item.name, icon: RiUserLine },
    ]),
  );
  const projectOptions: Record<string, Look> = Object.fromEntries(
    directory.projects.map((item) => [
      item.id,
      { label: item.title, icon: RiBox3Line },
    ]),
  );
  const filters: FilterDef<keyof DocumentsSearch>[] = [
    {
      key: "createdBy",
      label: "Created by",
      icon: RiQuillPenLine,
      options: { me: { label: "Me", icon: RiUserLine }, ...people },
    },
    {
      key: "project",
      label: "Project",
      icon: RiBox3Line,
      options: projectOptions,
    },
    {
      key: "label",
      label: "Label",
      icon: RiPriceTag3Line,
      options: labelLooks([
        ...(list.data?.items.flatMap((item) => item.labels) ?? []),
        ...(search.label ? [search.label] : []),
      ]),
    },
    {
      key: "visibility",
      label: "Visibility",
      icon: RiEyeLine,
      options: {
        user: { label: "Only me", icon: RiUserLine },
        workspace: { label: "Workspace", icon: RiEyeLine },
      },
    },
    {
      key: "collectionId",
      label: "Collection",
      icon: RiFileTextLine,
      options: Object.fromEntries(
        (collections.data?.pages.flatMap((page) => page.items) ?? []).map(
          (item) => [item.id, { label: item.title, icon: RiFileTextLine }],
        ),
      ),
    },
    {
      key: "archived",
      label: "Archive",
      icon: RiFileTextLine,
      options: {
        true: { label: "Archived", icon: RiFileTextLine },
        false: { label: "Active", icon: RiFileTextLine },
      },
    },
  ];
  for (const filter of filters) {
    const value = search[filter.key];
    if (value && !filter.options[value])
      filter.options[value] = {
        label: "Unavailable selection",
        icon: filter.icon,
      };
  }
  return (
    <Page
      title="Documents"
      width="wide"
      actions={
        <>
          <FilterMenu filters={filters} values={search} onChange={change} />
          {workspace.role !== "viewer" && (
            <IconAction
              label="New document"
              icon={RiAddLine}
              onClick={() => setCreating(true)}
            />
          )}
        </>
      }
    >
      {collections.hasNextPage && (
        <Button
          variant="ghost"
          disabled={collections.isFetchingNextPage}
          onClick={() => collections.fetchNextPage()}
        >
          Load more collection filters
        </Button>
      )}
      <FilterBar
        filters={filters}
        values={search}
        onChange={change}
        onClear={clear}
      />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          navigate({
            search: (prev) => ({
              ...prev,
              query: queryText.trim() || undefined,
              label: labelText.trim() || undefined,
              after: undefined,
            }),
          });
        }}
      >
        <Field>
          <FieldLabel htmlFor="document-search">Search whole words</FieldLabel>
          <Input
            id="document-search"
            value={queryText}
            maxLength={200}
            onChange={(event) => setQueryText(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="document-label-filter">Label (exact)</FieldLabel>
          <Input
            id="document-label-filter"
            value={labelText}
            maxLength={200}
            onChange={(event) => setLabelText(event.target.value)}
          />
        </Field>
        <Button variant="outline" type="submit">
          Search
        </Button>
      </form>
      <div className="flex flex-wrap gap-3">
        <DocumentChoice
          label="Sort"
          value={search.sort ?? "updatedAt"}
          options={[
            { id: "updatedAt", title: "Last edited" },
            { id: "createdAt", title: "Created" },
            { id: "title", title: "Title" },
          ]}
          onChange={(value) =>
            navigate({
              search: (prev) => ({
                ...prev,
                sort: value as DocumentsSearch["sort"],
                order: prev.order ?? "desc",
                after: undefined,
              }),
            })
          }
        />
        <DocumentChoice
          label="Order"
          value={search.order ?? (search.sort ? "asc" : "desc")}
          options={[
            { id: "asc", title: "Ascending" },
            { id: "desc", title: "Descending" },
          ]}
          onChange={(value) =>
            navigate({
              search: (prev) => ({
                ...prev,
                sort: prev.sort ?? "updatedAt",
                order: value as DocumentsSearch["order"],
                after: undefined,
              }),
            })
          }
        />
        <DocumentChoice
          label="Page size"
          value={search.limit ?? "24"}
          options={[...new Set(["24", "50", "100", search.limit ?? "24"])].map(
            (id) => ({ id, title: id }),
          )}
          onChange={(value) => change("limit", value)}
        />
      </div>
      <DocumentDirectoryPages members projects />
      <QueryState
        pending={list.isPending}
        error={list.error ?? directory.error ?? collections.error}
        retry={() => {
          list.refetch();
          directory.membersQuery.refetch();
          directory.agentsQuery.refetch();
          directory.projectsQuery.refetch();
          collections.refetch();
        }}
      />
      {list.data &&
        !list.error &&
        (list.data.items.length ? (
          <Gallery columns={4}>
            {list.data.items.map((document) => (
              <DocumentItem key={document.id} document={document} />
            ))}
          </Gallery>
        ) : search.createdBy ||
          search.project ||
          search.label ||
          search.visibility ||
          search.collectionId ||
          search.archived ||
          search.query ||
          search.after ? (
          <NoResults what="documents" onClear={clear} />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RiFileTextLine />
              </EmptyMedia>
              <EmptyTitle>No documents</EmptyTitle>
              <EmptyDescription>
                Notes and specs written by your team live here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ))}
      <div className="flex gap-2">
        {search.after && (
          <Button variant="outline" onClick={() => change("after", undefined)}>
            First page
          </Button>
        )}
        {list.data?.next && (
          <Button
            variant="outline"
            disabled={list.isFetching}
            onClick={() =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  after: list.data?.next ?? undefined,
                }),
              })
            }
          >
            Next page
          </Button>
        )}
      </div>
      {creating && <CreateDocument onClose={() => setCreating(false)} />}
    </Page>
  );
}

export function DocumentItem({
  document,
}: {
  document: { id: string; title: string };
}) {
  const detail = useDocument(document.id);
  const available = detail.error ? undefined : detail.data;
  return (
    <GalleryItem
      render={
        <Link
          to="/documents/$documentId"
          params={{ documentId: document.id }}
        />
      }
      className="aspect-[4/5] bg-card"
      tile={
        <p className="size-full mask-b-from-60% p-3 text-xs text-muted-foreground">
          {available
            ? excerptOf(available.body)
            : detail.error
              ? detail.error.message
              : "Loading document"}
        </p>
      }
      icon={RiFileTextLine}
      title={available?.title ?? document.title}
      menu={<DocumentMenu id={document.id} document={available} />}
    />
  );
}
function excerptOf(content: string) {
  return content
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ x]\]\s+)?/, ""))
    .join(" ")
    .replace(/[*_`]/g, "");
}

function CreateDocument({ onClose }: { onClose(): void }) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState("");
  const [projectId, setProjectId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [visibility, setVisibility] = useState<"user" | "workspace">("user");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { directory, canWrite, members } = useDocumentWriter(projectId);
  const acknowledged = useRef(false);
  const dirty = Boolean(
    title || body || labels || projectId || folderId || visibility !== "user",
  );
  useBlocker({
    shouldBlockFn: () =>
      !acknowledged.current &&
      (pending || (dirty && !window.confirm("Discard this new document?"))),
    enableBeforeUnload: () => !acknowledged.current && (pending || dirty),
  });
  async function create() {
    const parsed = parseDocumentLabels(labels);
    const invalid = documentInputError(title, body, parsed);
    if (invalid) {
      setError(new Error(invalid));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const document = await read(
        await api.documents.$post({
          param: { workspaceId },
          json: {
            title: title.trim(),
            body,
            labels: parsed,
            visibility,
            projectId: projectId || undefined,
            folderId: folderId || undefined,
          },
        }),
      );
      await invalidate();
      acknowledged.current = true;
      onClose();
      await navigate({
        to: "/documents/$documentId",
        params: { documentId: document.id },
      });
    } catch (error) {
      setError(
        error instanceof ApiError
          ? error
          : new Error(
              "Could not confirm creation. Check Documents before trying again.",
            ),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        showCloseButton={!pending}
        className="max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>New document</DialogTitle>
          <DialogDescription>
            Write a document in this workspace.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-document-title">Title</FieldLabel>
              <Input
                id="new-document-title"
                required
                maxLength={200}
                value={title}
                disabled={pending}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-document-body">Body</FieldLabel>
              <Textarea
                id="new-document-body"
                value={body}
                maxLength={100000}
                disabled={pending}
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-document-labels">
                Labels, one per line
              </FieldLabel>
              <Textarea
                id="new-document-labels"
                value={labels}
                disabled={pending}
                onChange={(event) => setLabels(event.target.value)}
              />
            </Field>
            <DocumentChoice
              label="Project"
              value={projectId}
              options={[{ id: "", title: "No project" }, ...directory.projects]}
              onChange={(value) => {
                setProjectId(value);
                setFolderId("");
              }}
              disabled={pending}
            />
            <DocumentDirectoryPages projects />
            <DocumentChoice
              label="Visibility"
              value={visibility}
              options={[
                { id: "user", title: "Only me" },
                { id: "workspace", title: "Workspace" },
              ]}
              onChange={(value) => {
                setVisibility(value as typeof visibility);
                setFolderId("");
              }}
              disabled={pending}
            />
            <FolderChoice
              key={projectId}
              projectId={projectId || null}
              visibility={visibility}
              value={folderId}
              onChange={setFolderId}
              disabled={pending}
            />
          </FieldGroup>
          <QueryState
            error={error ?? directory.error ?? members.error}
            retry={() => {
              directory.membersQuery.refetch();
              directory.agentsQuery.refetch();
              directory.projectsQuery.refetch();
              if (projectId) members.refetch();
            }}
          />
          {members.hasNextPage && !canWrite && (
            <Button
              variant="outline"
              type="button"
              onClick={() => members.fetchNextPage()}
            >
              Load more project members
            </Button>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !canWrite}>
              {pending ? "Creating" : "Create document"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
