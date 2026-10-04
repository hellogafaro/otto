import type { RemixiconComponentType } from "@remixicon/react";
import { cn } from "@workspace/ui/lib/utils";
import { cloneElement, type ReactElement, type ReactNode } from "react";

// Gallery views (projects, documents, files): not cards, but a tile with
// the title under it. Tiles have 8px corners and a faint ring that darkens on
// hover; columns sit 12px apart, rows 20px, so a title stays with its tile.
export function Gallery({
  columns,
  children,
}: {
  /** 3 for projects; 4 for smaller things like documents and files. */
  columns: 3 | 4;
  children: ReactNode;
}) {
  return (
    <ul
      className={cn(
        "grid gap-x-3 gap-y-5",
        columns === 3
          ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
      )}
    >
      {children}
    </ul>
  );
}

export function GalleryItem({
  render,
  tile,
  icon: Icon,
  title,
  className,
}: {
  /** What the item opens: a Link, or a button while there is no page. */
  render: ReactElement<{ className?: string; children?: ReactNode }>;
  /** The tile's content (a cover, a preview or an icon). */
  tile?: ReactNode;
  icon: RemixiconComponentType;
  title: string;
  /** The tile's shape and background, e.g. "aspect-video bg-muted". */
  className: string;
}) {
  return (
    <li>
      {cloneElement(render, {
        className:
          "group/item flex w-full flex-col gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        children: (
          <>
            <div
              className={cn(
                "overflow-hidden rounded-md ring-1 ring-foreground/10 transition-shadow group-hover/item:ring-foreground/20",
                className,
              )}
            >
              {tile}
            </div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <Icon className="shrink-0 text-muted-foreground" />
              <span className="truncate">{title}</span>
            </div>
          </>
        ),
      })}
    </li>
  );
}
