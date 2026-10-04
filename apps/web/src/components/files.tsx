import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiBox3Line,
  RiCalendarLine,
  RiChat1Line,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiDownloadLine,
  RiFolder3Line,
  RiPriceTag3Line,
} from "@remixicon/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { ContextMenuContent } from "@workspace/ui/components/context-menu";
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
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { FileRef } from "@/components/composer";
import { Section } from "@/components/detail";
import { Dither } from "@/components/dither";
import { Editor } from "@/components/editor/editor";
import { useAskAgent } from "@/components/floating-chat";
import { Gallery, GalleryItem } from "@/components/gallery";
import { IconAction } from "@/components/icon-action";
import { ItemMenuItems } from "@/components/item-menu";
import { mention } from "@/components/mentions";
import {
  ActorAvatar,
  actorOf,
  ChatIcon,
  projectLooks,
  resourceIcons,
  resourceKindOf,
  resourceTypes,
  shortDate,
  statuses,
  visibilityLooks,
} from "@/components/task-meta";
import { Topbar } from "@/components/topbar";
import {
  chats,
  currentUserId,
  folders,
  type Resource,
  tasks,
} from "@/mock/tasks";

// A file attached to a message or comment, as a resource for the viewer.
export function fileResource(file: FileRef, createdAt: string): Resource {
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
function fileType({ title, kind }: Resource) {
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
  resources: (Resource & { uploading?: boolean })[];
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
                render={<SidebarMenuButton onClick={() => open(resource.id)} />}
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
  onDelete,
}: {
  resources: Resource[];
  openId?: string;
  onOpen?: (id: string | undefined) => void;
  /** Tiles before the files in the same grid (Files' folders). */
  leading?: ReactNode;
  /** Deleting from the right-click menu; without it, no Delete. */
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
              <FileMenu
                resource={resource}
                onOpen={() => open(resource.id)}
                onDelete={onDelete && (() => onDelete(resource.id))}
              />
            }
          />
        ))}
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
  resources: Resource[];
  openId: string | undefined;
  onOpen: (id: string | undefined) => void;
}) {
  const navigate = useNavigate();
  const ask = useAskAgent();
  // Focus starts on the lightbox itself, not its first button (whose tooltip
  // would pop up and take the first Escape).
  const popup = useRef<HTMLDivElement>(null);
  const index = resources.findIndex(({ id }) => id === openId);
  const resource = resources[index];
  const step = (by: number) =>
    onOpen(resources[(index + by + resources.length) % resources.length].id);
  const Icon = resource && resourceIcons[resource.kind];

  return (
    <Dialog
      open={!!resource}
      onOpenChange={(open) => !open && onOpen(undefined)}
    >
      {resource && (
        <DialogContent
          ref={popup}
          initialFocus={popup}
          showCloseButton={false}
          fullScreen
          onKeyDown={(event) => {
            // Arrows inside a player seek; they don't change the resource.
            const target = event.target as HTMLElement;
            if (resources.length < 2 || target.closest("video, audio")) return;
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
                    <IconAction
                      label="Ask about this file"
                      icon={RiChat1Line}
                      onClick={() => {
                        // The page's floating chat takes it: the viewer
                        // closes and the bar starts with a link to the file.
                        onOpen(undefined);
                        ask(
                          `${mention({
                            type: "resource",
                            id: resource.id,
                            label: resource.title,
                          })} `,
                        );
                      }}
                    />
                    {resource.taskId && (
                      <IconAction
                        label="Open task"
                        icon={RiCheckboxCircleLine}
                        onClick={() =>
                          navigate({
                            to: "/tasks/$taskId",
                            params: { taskId: resource.taskId as string },
                          })
                        }
                      />
                    )}
                    {/* Not wired yet. */}
                    <IconAction label="Download" icon={RiDownloadLine} />
                    {/* Without the panel, Close sits here. */}
                    <span className="lg:hidden">
                      <IconAction
                        label="Close"
                        icon={RiCloseLine}
                        onClick={() => onOpen(undefined)}
                      />
                    </span>
                  </>
                }
              >
                {/* px-2 puts the icon on the 16px content line. */}
                <div className="flex min-w-0 items-center gap-2 px-2">
                  <Icon className="shrink-0 text-muted-foreground" />
                  <DialogTitle className="truncate">
                    {resource.title}
                  </DialogTitle>
                  <DialogDescription className="shrink-0 tabular-nums">
                    {resourceTypes[resource.kind]} ·{" "}
                    {shortDate.format(new Date(resource.createdAt))}
                  </DialogDescription>
                </div>
              </Topbar>
              {/* The stage fills the rest, with the page's 20px below. 48px
                  at the sides keeps the arrows (9px from the edges) clear of
                  the media. */}
              <div className="relative flex min-h-0 flex-1 items-center justify-center px-12 pb-5">
                <Preview resource={resource} />
                {resources.length > 1 && (
                  <>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Previous"
                      className="absolute left-2.25"
                      onClick={() => step(-1)}
                    >
                      <RiArrowLeftSLine />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Next"
                      className="absolute right-2.25"
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
                    onClick={() => onOpen(undefined)}
                  />
                }
              >
                <h2 className="truncate pl-3 text-sm font-medium">Details</h2>
              </Topbar>
              <div className="min-h-0 flex-1 scroll-fade-y overflow-y-auto">
                <FileDetails resource={resource} />
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
  onDelete,
}: {
  resource: Resource;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  const ask = useAskAgent();
  return (
    <ContextMenuContent className="w-48">
      <ItemMenuItems
        name={resource.title}
        onOpen={onOpen}
        onAsk={() =>
          ask(
            `${mention({ type: "resource", id: resource.id, label: resource.title })} `,
          )
        }
        // Not wired yet.
        onDownload={() => {}}
        link={`/files?open=${resource.id}`}
        onDelete={onDelete}
      />
    </ContextMenuContent>
  );
}

// What a file is, in one Properties list, each row in Otto's words: its
// folder, its project, its task and its chat (links, when it has them), who
// created it (the agent that made it, else the person who added it), who
// can see it and when it was added. Then its labels.
function FileDetails({ resource }: { resource: Resource }) {
  const project = resource.projectId
    ? projectLooks[resource.projectId]
    : undefined;
  const creator = resource.agentId ?? resource.ownerId ?? currentUserId;
  const visibility = visibilityLooks[resource.visibility ?? "workspace"];
  const task = resource.taskId
    ? tasks.find(({ id }) => id === resource.taskId)
    : undefined;
  const status = task && statuses[task.status];
  const chat = resource.chatId
    ? chats.find(({ id }) => id === resource.chatId)
    : undefined;
  const labels = resource.labels ?? [];
  // Its folder's path, top first ("Brand › Logos"), or the top of Files.
  const path: string[] = [];
  for (
    let folder = folders.find(({ id }) => id === resource.folderId);
    folder;
    folder = folders.find(({ id }) => id === folder?.parentId)
  )
    path.unshift(folder.title);
  return (
    <>
      <Section title="Properties">
        <DetailRow
          link={
            <Link
              to="/files"
              search={resource.folderId ? { folder: resource.folderId } : {}}
            />
          }
        >
          <RiFolder3Line />
          <span>{path.length ? path.join(" › ") : "Files"}</span>
        </DetailRow>
        {project && resource.projectId ? (
          <DetailRow
            link={
              <Link
                to="/projects/$projectId"
                params={{ projectId: resource.projectId }}
              />
            }
          >
            <project.icon className={project.className} />
            <span>{project.label}</span>
          </DetailRow>
        ) : (
          <DetailRow>
            <RiBox3Line />
            <span>No project</span>
          </DetailRow>
        )}
        {task && status && (
          <DetailRow
            link={<Link to="/tasks/$taskId" params={{ taskId: task.id }} />}
          >
            <status.icon className={status.className} />
            <span>{task.title}</span>
          </DetailRow>
        )}
        {chat && (
          <DetailRow
            link={<Link to="/chats/$chatId" params={{ chatId: chat.id }} />}
          >
            <ChatIcon chat={chat} />
            <span>{chat.title}</span>
          </DetailRow>
        )}
        <DetailRow>
          <ActorAvatar actorId={creator} />
          <span>Created by {actorOf(creator).name}</span>
        </DetailRow>
        <DetailRow>
          <visibility.icon />
          <span>{visibility.label}</span>
        </DetailRow>
        <DetailRow>
          <RiCalendarLine />
          <span>Added {shortDate.format(new Date(resource.createdAt))}</span>
        </DetailRow>
      </Section>
      {labels.length > 0 && (
        <Section title="Labels" count={labels.length}>
          {labels.map((label) => (
            <DetailRow
              key={label}
              link={<Link to="/files" search={{ label }} />}
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
function Preview({ resource }: { resource: Resource }) {
  const { url, kind, title } = resource;
  const type = fileType(resource).toLowerCase();

  if (kind === "video" && url) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: user files have no captions.
      <video
        src={url}
        controls
        className={cn("max-h-full max-w-full bg-black", frame)}
      />
    );
  }
  if (kind === "audio" && url) {
    return (
      <div className="flex w-80 flex-col gap-3">
        <TypeTile resource={resource} className="aspect-square w-full" />
        {/* biome-ignore lint/a11y/useMediaCaption: user files have no captions. */}
        <audio src={url} controls className="w-full" />
      </div>
    );
  }
  if (url && type === "pdf") {
    return (
      <iframe
        src={url}
        title={title}
        className={cn("size-full max-w-4xl bg-card", frame)}
      />
    );
  }
  if (url && type === "md") return <MarkdownFile url={url} />;
  // A canvas is an agent's HTML page, shown as it is, sandboxed.
  if (url && kind === "canvas") {
    return (
      <iframe
        src={url}
        title={title}
        sandbox=""
        className={cn("size-full max-w-4xl bg-white", frame)}
      />
    );
  }
  const picture =
    kind === "image" ? (url ?? resource.preview) : resource.preview;
  if (picture) {
    return (
      <img
        src={picture}
        alt={title}
        className={cn("max-h-full max-w-full", frame)}
      />
    );
  }
  return (
    <TypeTile resource={resource} className="aspect-[4/5] h-full max-h-96" />
  );
}

function TypeTile({
  resource,
  className,
}: {
  resource: Resource;
  className: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-muted",
        frame,
        className,
      )}
    >
      <span className="text-xs font-medium text-muted-foreground uppercase">
        {fileType(resource)}
      </span>
    </div>
  );
}

// A Markdown file as a page: the document column on a card that scrolls.
function MarkdownFile({ url }: { url: string }) {
  const [text, setText] = useState<string>();
  useEffect(() => {
    let current = true;
    fetch(url)
      .then((response) => response.text())
      .then((body) => current && setText(body));
    return () => {
      current = false;
    };
  }, [url]);

  return (
    <div
      className={cn(
        "h-full w-full max-w-3xl scroll-fade-y overflow-y-auto bg-card p-8",
        frame,
      )}
    >
      {text !== undefined && <Editor key={url} value={text} readOnly />}
    </div>
  );
}
