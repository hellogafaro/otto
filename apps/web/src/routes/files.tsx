import {
  RiAddLine,
  RiArchiveLine,
  RiBox3Line,
  RiChat1Line,
  RiFileTextLine,
  RiFolder3Fill,
  RiFolder3Line,
  RiFolderAddLine,
  RiLinkM,
  RiPriceTag3Line,
  RiSearchLine,
  RiUploadLine,
} from "@remixicon/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
} from "@workspace/ui/components/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { useRef, useState } from "react";
import { useCommandPalette } from "@/components/command-palette";
import { EmptyPage } from "@/components/empty-page";
import { FolderEdit } from "@/components/file-edit";
import { FileUploads } from "@/components/file-uploads";
import { FileGallery } from "@/components/files";
import {
  FilterBar,
  type FilterDef,
  FilterMenu,
  labelLooks,
  NoResults,
} from "@/components/filters";
import { useAskAgent } from "@/components/floating-chat";
import { GalleryItem } from "@/components/gallery";
import { IconAction } from "@/components/icon-action";
import { Page } from "@/components/page";
import { QueryState } from "@/components/query-state";
import { Topbar } from "@/components/topbar";
import { read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { fileKind, type SavedFolder } from "@/lib/file-library";
import { useWorkspace } from "@/lib/workspace";

export type FilesSearch = {
  folder?: string;
  project?: string;
  label?: string;
  open?: string;
  query?: string;
  sort?: "title" | "createdAt" | "updatedAt";
  order?: "asc" | "desc";
  archived?: boolean;
};

export function validateFilesSearch(
  search: Record<string, unknown>,
): FilesSearch {
  const text = (key: string, max = 200) =>
    typeof search[key] === "string" && search[key].length <= max
      ? search[key]
      : undefined;
  const sort =
    search.sort === "title" ||
    search.sort === "createdAt" ||
    search.sort === "updatedAt"
      ? search.sort
      : undefined;
  return {
    folder: text("folder", 128),
    project: text("project", 128),
    label: text("label"),
    open: text("open", 128),
    query: text("query", 200),
    sort,
    order:
      sort && (search.order === "asc" || search.order === "desc")
        ? search.order
        : undefined,
    archived:
      search.archived === true || search.archived === "true" ? true : undefined,
  };
}

type FilterKey = "project" | "label" | "archived";

export function FilesPage({ search }: { search: FilesSearch }) {
  const { workspaceId, workspace, api, user, invalidate } = useWorkspace();
  const directory = useDirectory();
  const navigate = useNavigate({ from: "/files" });
  const ask = useAskAgent();
  const openPalette = useCommandPalette();
  const picker = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<File[]>();
  const [editing, setEditing] = useState<SavedFolder | "new">();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const library = useInfiniteQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "library",
      search.folder,
      search.project,
      search.label,
      search.query,
      search.archived,
      search.sort,
      search.order,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.library.$get({
          param: { workspaceId },
          query: {
            limit: "100",
            ...(search.folder ? { folderId: search.folder } : {}),
            ...(search.project ? { projectId: search.project } : {}),
            ...(search.label ? { label: search.label } : {}),
            ...(search.query ? { query: search.query } : {}),
            archived: search.archived ? "true" : "false",
            sort: search.sort ?? "title",
            order: search.order ?? "asc",
            ...(pageParam ? { after: pageParam } : {}),
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const folder = library.data?.pages[0]?.folder;
  const entries = library.data?.pages.flatMap((page) => page.items) ?? [];
  const files = entries
    .filter((entry) => entry.type === "file")
    .map((file) => ({
      id: file.id,
      title: file.title,
      kind: fileKind(file.mediaType),
      createdAt: file.createdAt ?? "",
      folderId: file.folderId ?? undefined,
      projectId: file.projectId ?? undefined,
      ownerId: file.ownerId,
      labels: file.labels,
      visibility: file.visibility,
    }));
  const canWrite = workspace.role !== "viewer";
  const fileInput = (
    <input
      ref={picker}
      type="file"
      multiple
      hidden
      onChange={(event) => {
        if (event.target.files?.length) setUploads([...event.target.files]);
        event.target.value = "";
      }}
    />
  );
  const projectId = folder?.projectId ?? search.project;
  const filters: FilterDef<FilterKey>[] = [
    {
      key: "project",
      label: "Project",
      icon: RiBox3Line,
      options: Object.fromEntries(
        directory.projects.map((project) => [
          project.id,
          { label: project.title, icon: RiBox3Line },
        ]),
      ),
    },
    {
      key: "label",
      label: "Label",
      icon: RiPriceTag3Line,
      options: labelLooks(
        entries.flatMap((entry) =>
          entry.type === "folder" ? [] : entry.labels,
        ),
      ),
    },
  ];
  filters.push({
    key: "archived",
    label: "Archive",
    icon: RiArchiveLine,
    options: { true: { label: "Archived", icon: RiArchiveLine } },
  });
  const values = { ...search, archived: search.archived ? "true" : undefined };
  const change = (key: FilterKey, value: string | undefined) =>
    navigate({
      search: (previous) => ({
        ...previous,
        [key]: key === "archived" ? value === "true" || undefined : value,
        ...(key === "project" ? { folder: undefined, open: undefined } : {}),
      }),
    });
  async function act(operation: () => Promise<unknown>) {
    setPending(true);
    setError(undefined);
    try {
      await operation();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error("Unable to update folder."),
      );
    } finally {
      setPending(false);
    }
  }
  const editFolder = (id: string) =>
    act(async () =>
      setEditing(
        await read(
          await api.folders[":id"].$get({ param: { workspaceId, id } }),
        ),
      ),
    );
  const archiveFolder = (id: string, archived: boolean) =>
    act(async () => {
      await read(
        await api.folders[":id"].archive.$post({
          param: { workspaceId, id },
          json: { archived },
        }),
      );
      await invalidate();
    });
  if (
    !library.isPending &&
    !library.error &&
    !library.hasNextPage &&
    entries.length === 0 &&
    !search.folder &&
    !search.project &&
    !search.label &&
    !search.query &&
    !search.archived
  )
    return (
      <>
        <EmptyPage
          icon={RiFolder3Line}
          title="No files"
          description="Files you upload and agents make collect here."
          ask={
            canWrite
              ? {
                  about: "your files",
                  action: "New file",
                  start: "Make a file with ",
                }
              : undefined
          }
        >
          {canWrite && (
            // Uploading is a person's own action, beside asking for one.
            <Button
              size="sm"
              variant="outline"
              onClick={() => picker.current?.click()}
            >
              <RiUploadLine data-icon="inline-start" />
              Upload file
            </Button>
          )}
          {fileInput}
        </EmptyPage>
        {uploads && (
          <FileUploads
            files={uploads}
            folderId={undefined}
            projectId={undefined}
            folderVisibility={undefined}
            onClose={() => setUploads(undefined)}
          />
        )}
      </>
    );
  return (
    <>
      {folder && (
        <Topbar>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={
                        <Link
                          to="/files"
                          search={{ project: folder.projectId ?? undefined }}
                        />
                      }
                    />
                  }
                >
                  <RiFolder3Line />
                  Files
                </BreadcrumbLink>
              </BreadcrumbItem>
              {folder.path.map((step) => (
                <span key={step.id} className="contents">
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          nativeButton={false}
                          render={
                            <Link
                              to="/files"
                              search={{
                                folder: step.id,
                                project: folder.projectId ?? undefined,
                              }}
                            />
                          }
                        />
                      }
                    >
                      <RiFolder3Line />
                      {step.title}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                </span>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </Topbar>
      )}
      <Page
        title={folder?.title ?? "Files"}
        width="wide"
        actions={
          <>
            <FilterMenu filters={filters} values={values} onChange={change} />
            <IconAction
              label="Search"
              icon={RiSearchLine}
              onClick={() => openPalette("files")}
            />
            {directory.projectsQuery.hasNextPage && (
              <Button
                variant="ghost"
                disabled={directory.projectsQuery.isFetchingNextPage}
                onClick={() => directory.projectsQuery.fetchNextPage()}
              >
                More projects
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Add"
                    disabled={
                      !canWrite ||
                      folder?.archived ||
                      library.isPending ||
                      Boolean(library.error)
                    }
                  />
                }
              >
                <RiAddLine />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => picker.current?.click()}>
                    <RiUploadLine />
                    Upload file
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={(folder?.path.length ?? 0) >= 8}
                    onClick={() => setEditing("new")}
                  >
                    <RiFolderAddLine />
                    New folder
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {folder?.createdBy === user.id && canWrite && (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => setEditing(folder)}
              >
                Edit folder
              </Button>
            )}
            {fileInput}
          </>
        }
      >
        <FilterBar
          filters={filters}
          values={values}
          onChange={change}
          onClear={() =>
            navigate({
              search: { folder: search.folder, project: search.project },
            })
          }
        />
        <QueryState
          pending={library.isPending}
          error={library.error ?? directory.error}
          retry={() => {
            void library.refetch();
            void directory.membersQuery.refetch();
            void directory.projectsQuery.refetch();
            void directory.agentsQuery.refetch();
          }}
        />
        {error && <p role="alert">{error.message}</p>}
        {!library.isPending &&
          !library.error &&
          entries.length === 0 &&
          !library.hasNextPage &&
          (search.query || search.label || search.project || search.archived ? (
            <NoResults
              what="files and documents"
              onClear={() =>
                navigate({
                  search: search.folder ? { folder: search.folder } : {},
                })
              }
            />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RiFolder3Line />
                </EmptyMedia>
                <EmptyTitle>This folder is empty</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ))}
        <FileGallery
          resources={files}
          openId={search.open}
          onOpen={(id) =>
            navigate({
              search: (previous) => ({ ...previous, open: id }),
              replace: true,
            })
          }
          leading={entries
            .filter((entry) => entry.type === "folder")
            .map((entry) => (
              <GalleryItem
                key={entry.id}
                render={
                  <Link
                    to="/files"
                    search={{
                      folder: entry.id,
                      project: entry.projectId ?? undefined,
                      archived: search.archived,
                    }}
                  />
                }
                className="flex aspect-[4/5] flex-col items-center justify-center gap-2 bg-muted"
                tile={
                  <RiFolder3Fill className="size-10 text-muted-foreground" />
                }
                icon={RiFolder3Line}
                title={entry.title}
                menu={
                  <ContextMenuContent>
                    <ContextMenuGroup>
                      <ContextMenuItem
                        onClick={() =>
                          navigate({
                            to: "/files",
                            search: {
                              folder: entry.id,
                              project: entry.projectId ?? undefined,
                              archived: search.archived,
                            },
                          })
                        }
                      >
                        Open
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() =>
                          ask(
                            `About the folder ${entry.title} (/files?folder=${entry.id}), `,
                          )
                        }
                      >
                        <RiChat1Line />
                        Ask about it
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={pending}
                        onClick={() =>
                          act(() =>
                            navigator.clipboard.writeText(
                              `${location.origin}/files?folder=${encodeURIComponent(entry.id)}${entry.projectId ? `&project=${encodeURIComponent(entry.projectId)}` : ""}`,
                            ),
                          )
                        }
                      >
                        <RiLinkM />
                        Copy link
                      </ContextMenuItem>
                      {canWrite && entry.ownerId === user.id && (
                        <>
                          <ContextMenuItem
                            disabled={pending}
                            onClick={() => editFolder(entry.id)}
                          >
                            Edit folder
                          </ContextMenuItem>
                          <ContextMenuItem
                            disabled={pending}
                            onClick={() =>
                              archiveFolder(entry.id, !entry.archived)
                            }
                          >
                            {entry.archived
                              ? "Restore"
                              : "Archive empty folder"}
                          </ContextMenuItem>
                        </>
                      )}
                    </ContextMenuGroup>
                  </ContextMenuContent>
                }
              />
            ))}
          trailing={entries
            .filter((entry) => entry.type === "document")
            .map((entry) => (
              <GalleryItem
                key={entry.id}
                render={
                  <Link
                    to="/documents/$documentId"
                    params={{ documentId: entry.id }}
                  />
                }
                className="flex aspect-[4/5] items-center justify-center bg-muted"
                tile={
                  <RiFileTextLine className="size-10 text-muted-foreground" />
                }
                icon={RiFileTextLine}
                title={entry.title}
              />
            ))}
        />
        {library.hasNextPage && (
          <Button
            variant="outline"
            disabled={library.isFetchingNextPage}
            onClick={() => library.fetchNextPage()}
          >
            {library.isFetchingNextPage ? "Loading" : "Load more"}
          </Button>
        )}
        {library.isFetchNextPageError && (
          <QueryState
            error={library.error}
            retry={() => library.fetchNextPage()}
          />
        )}
      </Page>
      {editing && (
        <FolderEdit
          key={editing === "new" ? "new" : editing.id}
          folder={editing === "new" ? undefined : editing}
          parentId={search.folder}
          projectId={projectId ?? undefined}
          parentVisibility={folder?.visibility}
          onClose={() => setEditing(undefined)}
        />
      )}
      {uploads && (
        <FileUploads
          files={uploads}
          folderId={search.folder}
          projectId={projectId ?? undefined}
          folderVisibility={folder?.visibility}
          onClose={() => setUploads(undefined)}
        />
      )}
    </>
  );
}
