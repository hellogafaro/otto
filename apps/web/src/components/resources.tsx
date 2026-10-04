import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiDownloadLine,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useRef, useState } from "react";
import { AskOtto } from "@/components/ask-otto";
import { Dither } from "@/components/dither";
import { Editor } from "@/components/editor/editor";
import { Gallery, GalleryItem } from "@/components/gallery";
import { IconAction } from "@/components/icon-action";
import {
  resourceIcons,
  resourceTypes,
  shortDate,
} from "@/components/task-meta";
import { Topbar } from "@/components/topbar";
import type { Resource, ResourceKind } from "@/mock/tasks";

export function resourceKindOf(type: string): ResourceKind {
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("text/") || type === "application/pdf") return "document";
  return "file";
}

// A file's extension, or its type when the title has none.
function fileType({ title, kind }: Resource) {
  return title.match(/\.(\w+)$/)?.[1] ?? resourceTypes[kind];
}

// Resources as a gallery; a tile opens the lightbox. The open resource can be
// kept by the caller (the Resources page keeps it in the URL).
export function ResourceGallery({
  resources,
  openId,
  onOpen,
}: {
  resources: Resource[];
  openId?: string;
  onOpen?: (id: string | undefined) => void;
}) {
  const [localId, setLocalId] = useState<string>();
  const shown = onOpen ? openId : localId;
  const open = onOpen ?? setLocalId;

  return (
    <>
      <Gallery columns={4}>
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
          />
        ))}
      </Gallery>
      <Lightbox resources={resources} openId={shown} onOpen={open} />
    </>
  );
}

// One resource full screen, like a page: the 48px top bar (icon, title and
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
          <Topbar
            actions={
              <>
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
                <IconAction
                  label="Close"
                  icon={RiCloseLine}
                  onClick={() => onOpen(undefined)}
                />
              </>
            }
          >
            {/* px-2 puts the icon on the 16px content line. */}
            <div className="flex min-w-0 items-center gap-2 px-2">
              <Icon className="shrink-0 text-muted-foreground" />
              <DialogTitle className="truncate">{resource.title}</DialogTitle>
              <DialogDescription className="shrink-0 tabular-nums">
                {resourceTypes[resource.kind]} ·{" "}
                {shortDate.format(new Date(resource.createdAt))}
              </DialogDescription>
            </div>
          </Topbar>
          {/* The stage fills the rest. 48px at the sides keeps the arrows (9px
              from the edges) clear of the media. */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-12">
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
          {/* Ask Otto 16px above the bottom, centered like on a page. */}
          <div className="shrink-0 p-4">
            <AskOtto about="this resource" />
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

const frame = "rounded-md ring-1 ring-foreground/10";

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
        "h-full w-full max-w-3xl overflow-y-auto bg-card p-8",
        frame,
      )}
    >
      {text !== undefined && <Editor key={url} value={text} readOnly />}
    </div>
  );
}
