import {
  RiArchiveLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiBox3Line,
  RiCalendarLine,
  RiChat1Line,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiDownloadLine,
  RiEditLine,
  RiFolder3Line,
  RiLinkM,
  RiPriceTag3Line,
  RiShareLine,
} from "@remixicon/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
} from "@workspace/ui/components/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { toast } from "@workspace/ui/components/sonner";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { FileRef } from "@/components/composer";
import { Section } from "@/components/detail";
import { Dither } from "@/components/dither";
import { Editor } from "@/components/editor/editor";
import { FileEdit } from "@/components/file-edit";
import { FileShares } from "@/components/file-shares";
import { useAskAgent } from "@/components/floating-chat";
import { Gallery, GalleryItem } from "@/components/gallery";
import { IconAction } from "@/components/icon-action";
import { mention } from "@/components/mentions";
import { QueryState } from "@/components/query-state";
import {
  ActorAvatar,
  resourceIcons,
  resourceKindOf,
  resourceTypes,
  shortDate,
  visibilityLooks,
} from "@/components/task-meta";
import { Topbar } from "@/components/topbar";
import { ApiError, read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import {
  downloadFile,
  type FilePresentation,
  previewBytes,
  type SavedFile,
  savedResource,
} from "@/lib/file-library";
import { useWorkspace } from "@/lib/workspace";

// A file attached to a message or comment, as a resource for the viewer.
export function fileResource(
  file: FileRef,
  createdAt: string,
): FilePresentation {
  return {
    id: file.id,
    title: file.name,
    kind: resourceKindOf(file.type),
    url: file.url,
    preview: file.type.startsWith("image/") ? file.url : undefined,
    createdAt,
  };
}

// A file's extension, or its type when the title has none.
function fileType({ title, kind }: FilePresentation) {
  return title.match(/\.(\w+)$/)?.[1] ?? resourceTypes[kind];
}

// Files as panel rows (a task's, a chat's): the icon shows the type,
// hovering shows the full title, then type and date; a row opens the
// lightbox (its own, or the page's through onOpen, so other parts of the page
// open the same one). Uploading rows show a spinner.
export function FileItems({
  resources,
  onOpen,
}: {
  resources: (FilePresentation & { uploading?: boolean })[];
  onOpen?: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string>();
  const open = onOpen ?? setOpenId;
  return (
    <>
      {resources.map((resource) => {
        const Icon = resource.uploading
          ? Spinner
          : resourceIcons[resource.kind];
        return (
          <SidebarMenuItem key={resource.id}>
            <HoverCard>
              <HoverCardTrigger
                render={
                  <SidebarMenuButton
                    disabled={resource.uploading}
                    onClick={() => open(resource.id)}
                  />
                }
              >
                <Icon />
                <span>{resource.title}</span>
              </HoverCardTrigger>
              <HoverCardContent side="left" align="start">
                <span className="font-medium">{resource.title}</span>
                <span className="text-muted-foreground">
                  {resourceTypes[resource.kind]} ·{" "}
                  {shortDate.format(new Date(resource.createdAt))}
                </span>
              </HoverCardContent>
            </HoverCard>
          </SidebarMenuItem>
        );
      })}
      {!onOpen && (
        <Lightbox resources={resources} openId={openId} onOpen={setOpenId} />
      )}
    </>
  );
}

// Files as a gallery; a tile opens the lightbox. The open file can be kept
// by the caller (the Files page keeps it in the URL).
export function FileGallery({
  resources,
  openId,
  onOpen,
  leading,
  trailing,
}: {
  resources: FilePresentation[];
  openId?: string;
  onOpen?: (id: string | undefined) => void;
  /** Tiles before the files in the same grid (Files' folders). */
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Retained for existing callers; File deletion has no API and is not exposed. */
  onDelete?: (id: string) => void;
}) {
  const [localId, setLocalId] = useState<string>();
  const shown = onOpen ? openId : localId;
  const open = onOpen ?? setLocalId;

  return (
    <>
      <Gallery columns={4}>
        {leading}
        {resources.map((resource) => (
          <GalleryItem
            key={resource.id}
            render={<button type="button" onClick={() => open(resource.id)} />}
            className="flex aspect-[4/5] items-center justify-center bg-muted"
            tile={
              // Its picture when it has one, else its file type (the icon is
              // already by the title).
              resource.preview ? (
                <Dither src={resource.preview} className="size-full" />
              ) : (
                <span className="text-xs font-medium text-muted-foreground uppercase">
                  {fileType(resource)}
                </span>
              )
            }
            icon={resourceIcons[resource.kind]}
            title={resource.title}
            menu={
              <FileMenu resource={resource} onOpen={() => open(resource.id)} />
            }
          />
        ))}
        {trailing}
      </Gallery>
      <Lightbox resources={resources} openId={shown} onOpen={open} />
    </>
  );
}

// One file full screen, like a page: the 44px top bar (icon, title and
// details on the left, actions on the right), then its read-only preview
// centered with the gallery's corners and ring. Arrows (buttons or ← →) step
// through the others.
export function Lightbox({
  resources,
  openId,
  onOpen,
}: {
  resources: FilePresentation[];
  openId: string | undefined;
  onOpen: (id: string | undefined) => void;
}) {
  const navigate = useNavigate();
  const ask = useAskAgent();
  const { workspaceId, workspace, api, user, invalidate } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<Error>();
  const saved = useQuery({
    queryKey: ["workspace", workspaceId, "file", openId],
    enabled: Boolean(openId),
    queryFn: async () =>
      read(
        await api.files[":id"].$get({
          param: { workspaceId, id: openId ?? "" },
        }),
      ),
  });
  const queryClient = useQueryClient();
  // Authority failures hide retained bytes; transient failures keep an open draft.
  const denied =
    saved.error instanceof ApiError &&
    [401, 403, 404].includes(saved.error.status);
  const file = denied ? undefined : saved.data;
  useEffect(() => {
    if (denied && openId) {
      setEditing(false);
      setSharing(false);
      queryClient.removeQueries({
        queryKey: ["workspace", workspaceId, "file-preview", openId],
      });
    }
  }, [denied, openId, queryClient, workspaceId]);
  const locked = busy || editing || sharing;
  const canWrite = workspace.role !== "viewer";
  const canEdit = canWrite && file?.ownerId === user.id;
  async function act(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await operation();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause : new Error("Unable to update file."),
      );
    } finally {
      setBusy(false);
    }
  }
  // Focus starts on the lightbox itself, not its first button (whose tooltip
  // would pop up and take the first Escape).
  const popup = useRef<HTMLDivElement>(null);
  const index = resources.findIndex(({ id }) => id === openId);
  const resource = denied
    ? undefined
    : file
      ? savedResource(file)
      : resources[index];
  const taskId = denied ? undefined : resources[index]?.taskId;
  const step = (by: number) =>
    onOpen(resources[(index + by + resources.length) % resources.length].id);
  const Icon = resource && resourceIcons[resource.kind];

  return (
    <Dialog
      open={Boolean(openId)}
      onOpenChange={(open) => !open && !locked && onOpen(undefined)}
    >
      {openId && (
        <DialogContent
          ref={popup}
          initialFocus={popup}
          showCloseButton={false}
          fullScreen
          onKeyDown={(event) => {
            // Arrows inside a player seek; they don't change the resource.
            const target = event.target as HTMLElement;
            if (
              resources.length < 2 ||
              index < 0 ||
              busy ||
              editing ||
              sharing ||
              target.closest("video, audio, input, textarea, [contenteditable]")
            )
              return;
            if (event.key === "ArrowLeft") step(-1);
            if (event.key === "ArrowRight") step(1);
          }}
        >
          {/* Two full-height columns: the file with its own top bar, and
              on wide screens its details, a right panel with its own top bar
              (Details and Close in the corner, like the panel toggle). */}
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar
                actions={
                  <>
                    {canWrite && file && (
                      <IconAction
                        label="Ask about this file"
                        icon={RiChat1Line}
                        onClick={() => {
                          if (locked || !file) return;
                          // The page's floating chat takes it: the viewer
                          // closes and the bar starts with a link to the file.
                          onOpen(undefined);
                          ask(
                            `${mention({
                              type: "file",
                              id: file?.id ?? openId,
                              label: file?.title ?? resource?.title ?? "File",
                            })} `,
                          );
                        }}
                      />
                    )}
                    {taskId && (
                      <IconAction
                        label="Open task"
                        icon={RiCheckboxCircleLine}
                        onClick={() =>
                          navigate({
                            to: "/tasks/$taskId",
                            params: { taskId },
                          })
                        }
                      />
                    )}
                    {file && (
                      <>
                        <IconAction
                          label="Download"
                          icon={RiDownloadLine}
                          onClick={() =>
                            act(() =>
                              downloadFile(workspaceId, file.id, file.title),
                            )
                          }
                        />
                        {canEdit && (
                          <IconAction
                            label="Edit file"
                            icon={RiEditLine}
                            onClick={() => !locked && setEditing(true)}
                          />
                        )}
                        {canWrite && (
                          <IconAction
                            label="Share selected file"
                            icon={RiShareLine}
                            onClick={() => !locked && setSharing(true)}
                          />
                        )}
                        {canEdit && (
                          <Button
                            variant="ghost"
                            disabled={locked}
                            onClick={() =>
                              act(async () => {
                                await read(
                                  await api.files[":id"].archive.$post({
                                    param: { workspaceId, id: file.id },
                                    json: { archived: !file.archived },
                                  }),
                                );
                                await invalidate();
                                onOpen(undefined);
                              })
                            }
                          >
                            <RiArchiveLine data-icon="inline-start" />
                            {file.archived ? "Restore" : "Archive"}
                          </Button>
                        )}
                      </>
                    )}
                    {/* Without the panel, Close sits here. */}
                    <span className="lg:hidden">
                      <IconAction
                        label="Close"
                        icon={RiCloseLine}
                        onClick={() => !locked && onOpen(undefined)}
                      />
                    </span>
                  </>
                }
              >
                {/* px-2 puts the icon on the 16px content line. */}
                <div className="flex min-w-0 items-center gap-2 px-2">
                  {Icon && <Icon className="shrink-0 text-muted-foreground" />}
                  <DialogTitle className="truncate">
                    {resource?.title ?? "File"}
                  </DialogTitle>
                  <DialogDescription className="shrink-0 tabular-nums">
                    {resource && resourceTypes[resource.kind]} ·{" "}
                    {resource?.createdAt &&
                      shortDate.format(new Date(resource.createdAt))}
                  </DialogDescription>
                </div>
              </Topbar>
              {/* The stage fills the rest, with the page's 20px below. 48px
                  at the sides keeps the arrows (9px from the edges) clear of
                  the media. */}
              <div className="relative flex min-h-0 flex-1 items-center justify-center px-12 pb-5">
                <QueryState
                  pending={saved.isPending}
                  error={saved.error}
                  retry={() => saved.refetch()}
                />
                {actionError && <p role="alert">{actionError.message}</p>}
                {file && <Preview file={file} />}
                {file && editing && (
                  <FileEdit
                    key={file.id}
                    file={file}
                    onClose={() => setEditing(false)}
                  />
                )}
                {file && sharing && (
                  <FileShares
                    key={file.id}
                    file={file}
                    onClose={() => setSharing(false)}
                  />
                )}
                {resources.length > 1 && index >= 0 && (
                  <>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Previous"
                      className="absolute left-2.25"
                      disabled={busy || editing || sharing}
                      onClick={() => step(-1)}
                    >
                      <RiArrowLeftSLine />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Next"
                      className="absolute right-2.25"
                      disabled={busy || editing || sharing}
                      onClick={() => step(1)}
                    >
                      <RiArrowRightSLine />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <aside
              aria-label="Details"
              className="hidden w-70 shrink-0 flex-col border-l lg:flex"
            >
              <Topbar
                actions={
                  <IconAction
                    label="Close"
                    icon={RiCloseLine}
                    onClick={() => !locked && onOpen(undefined)}
                  />
                }
              >
                <h2 className="truncate pl-3 text-sm font-medium">Details</h2>
              </Topbar>
              <div className="no-scrollbar min-h-0 flex-1 scroll-fade-y overflow-y-auto">
                {file && <FileDetails file={file} />}
              </div>
            </aside>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

const frame = "rounded-md ring-1 ring-foreground/10";

// A file's right-click menu: the shared item menu (open, ask an agent about
// it, download, copy its link, delete).
function FileMenu({
  resource,
  onOpen,
}: {
  resource: FilePresentation;
  onOpen(): void;
}) {
  const { workspaceId, workspace } = useWorkspace();
  const ask = useAskAgent();
  const canAsk = workspace.role !== "viewer";
  const [error, setError] = useState<Error>();
  async function act(operation: () => Promise<unknown>) {
    try {
      await operation();
      setError(undefined);
    } catch (cause) {
      const error =
        cause instanceof Error ? cause : new Error("Unable to perform action.");
      setError(error);
      toast.error(error.message);
    }
  }
  return (
    <ContextMenuContent className="w-48">
      <ContextMenuGroup>
        <ContextMenuItem onClick={onOpen}>Open</ContextMenuItem>
        {canAsk && (
          <ContextMenuItem
            onClick={() =>
              ask(
                `${mention({ type: "file", id: resource.id, label: resource.title })} `,
              )
            }
          >
            <RiChat1Line />
            Ask about it
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() =>
            act(() => downloadFile(workspaceId, resource.id, resource.title))
          }
        >
          <RiDownloadLine />
          Download
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() =>
            act(() =>
              navigator.clipboard.writeText(
                `${location.origin}/files?open=${encodeURIComponent(resource.id)}`,
              ),
            )
          }
        >
          <RiLinkM />
          Copy link
        </ContextMenuItem>
        {error && <ContextMenuItem disabled>{error.message}</ContextMenuItem>}
      </ContextMenuGroup>
    </ContextMenuContent>
  );
}

function FileDetails({ file }: { file: SavedFile }) {
  const { api, workspaceId } = useWorkspace();
  const directory = useDirectory();
  const folder = useQuery({
    queryKey: ["workspace", workspaceId, "folder", file.folderId],
    enabled: Boolean(file.folderId),
    queryFn: async () =>
      read(
        await api.folders[":id"].$get({
          param: { workspaceId, id: file.folderId ?? "" },
        }),
      ),
  });
  const project = directory.projects.find(
    (project) => project.id === file.projectId,
  );
  const creator = file.creatorAgentId ?? file.ownerId;
  const visibility = visibilityLooks[file.visibility];
  return (
    <>
      <Section title="Properties">
        <DetailRow
          link={
            <Link
              to="/files"
              search={{
                folder: file.folderId ?? undefined,
                project: file.projectId ?? undefined,
              }}
            />
          }
        >
          <RiFolder3Line />
          <span>
            {file.folderId
              ? (folder.data?.path.map((step) => step.title).join(" › ") ??
                "Folder unavailable")
              : "Files"}
          </span>
        </DetailRow>
        <QueryState error={folder.error} retry={() => folder.refetch()} />
        <DetailRow
          link={
            project && (
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
              />
            )
          }
        >
          <RiBox3Line />
          <span>
            {project?.title ??
              (file.projectId ? "Project unavailable" : "No project")}
          </span>
        </DetailRow>
        <DetailRow>
          <ActorAvatar actorId={creator} />
          <span>Created by {directory.actorOf(creator).name}</span>
        </DetailRow>
        <DetailRow>
          <visibility.icon />
          <span>{visibility.label}</span>
        </DetailRow>
        <DetailRow>
          <RiCalendarLine />
          <span>
            {file.createdAt && shortDate.format(new Date(file.createdAt))}
          </span>
        </DetailRow>
        <DetailRow>
          <RiDownloadLine />
          <span>{file.byteLength.toLocaleString()} bytes</span>
        </DetailRow>
      </Section>
      {file.labels.length > 0 && (
        <Section title="Labels" count={file.labels.length}>
          {file.labels.map((label) => (
            <DetailRow
              key={label}
              link={
                <Link
                  to="/files"
                  search={{
                    label,
                    folder: file.folderId ?? undefined,
                    project: file.projectId ?? undefined,
                  }}
                />
              }
            >
              <RiPriceTag3Line />
              <span>{label}</span>
            </DetailRow>
          ))}
        </Section>
      )}
    </>
  );
}

// A panel row: a link when it leads somewhere, else plain text.
function DetailRow({
  link,
  children,
}: {
  link?: React.ReactElement;
  children: React.ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={link ?? <div />}
        className={link ? undefined : "pointer-events-none"}
      >
        {children}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// Read-only, by type: images as they are, video and audio in the browser's
// players, PDFs in its PDF viewer, Markdown rendered like a document. Anything
// else (or without a file) shows its type.
function Preview({ file }: { file: SavedFile }) {
  const { workspaceId } = useWorkspace();
  const mediaType = file.mediaType.split(";")[0]?.trim() ?? file.mediaType;
  const previewable =
    /^(image|video|audio)\//.test(mediaType) ||
    ["text/html", "text/markdown", "application/pdf"].includes(mediaType) ||
    file.title.endsWith(".md");
  const preview = useQuery({
    queryKey: ["workspace", workspaceId, "file-preview", file.id, file.sha256],
    enabled: previewable,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const blob = await previewBytes(workspaceId, file, signal);
      const text =
        mediaType === "text/html" ||
        mediaType === "text/markdown" ||
        file.title.endsWith(".md")
          ? await blob.text()
          : undefined;
      return { blob, text };
    },
  });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!preview.data || preview.error) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(preview.data.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [preview.data, preview.error]);
  if (!previewable)
    return <p>This file type has no preview. Download it to open it.</p>;
  if (preview.error)
    return <QueryState error={preview.error} retry={() => preview.refetch()} />;
  if (!preview.data || !url) return <Spinner aria-label="Loading preview" />;
  if (mediaType === "text/html")
    return (
      <iframe
        title={file.title}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">${preview.data.text ?? ""}`}
        className={cn("size-full max-w-4xl bg-card", frame)}
      />
    );
  if (preview.data.text !== undefined)
    return (
      <div
        className={cn(
          "no-scrollbar h-full w-full max-w-3xl overflow-y-auto bg-card p-8",
          frame,
        )}
      >
        <Editor key={file.id} value={preview.data.text} readOnly />
      </div>
    );
  if (mediaType.startsWith("image/"))
    return (
      <img
        src={url}
        alt={file.title}
        className={cn("max-h-full max-w-full", frame)}
      />
    );
  if (mediaType.startsWith("video/"))
    return (
      // biome-ignore lint/a11y/useMediaCaption: uploaded files do not include caption tracks.
      <video
        src={url}
        controls
        className={cn("max-h-full max-w-full", frame)}
      />
    );
  if (mediaType.startsWith("audio/"))
    return (
      // biome-ignore lint/a11y/useMediaCaption: uploaded files do not include caption tracks.
      <audio src={url} controls />
    );
  return (
    <iframe
      src={url}
      title={file.title}
      sandbox=""
      className={cn("size-full max-w-4xl bg-card", frame)}
    />
  );
}
