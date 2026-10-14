import { cn } from "~/lib/utils";

/** Otto: A static placeholder block; skeletons never animate, so long loads cost nothing. */
function Skeleton({
  className,
  tone = "default",
  ...props
}: React.ComponentProps<"div"> & {
  /** `faint` is a lighter block for large chart areas. */
  tone?: "default" | "faint";
}) {
  return (
    <div
      className={cn("rounded-sm bg-muted", tone === "faint" && "bg-muted-foreground/10", className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

/** Fixed, varied text widths, so stand-in rows look like names without changing per render. */
const TEXT_WIDTHS = ["w-3/5", "w-2/5", "w-1/2", "w-3/4", "w-1/3", "w-2/3"] as const;

const DEFAULT_SECTIONS = [3, 5] as const;

/** Announces the loading region once; the blocks themselves are hidden from assistive tech. */
function SkeletonRegion({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden className="contents">
        {children}
      </div>
    </div>
  );
}

/**
 * Otto: Stand-in sidebar rows in the roster's geometry: a 28px section label, then 28px rows
 * 2px apart with a 16px avatar 6px in and a name bar, so loaded rows land where these were.
 */
function SkeletonSidebarRows({
  label,
  sections = DEFAULT_SECTIONS,
  headings = true,
}: {
  readonly label: string;
  /** Rows per section. */
  readonly sections?: readonly number[];
  /** Whether each section starts with a label bar. */
  readonly headings?: boolean;
}) {
  return (
    <SkeletonRegion label={label} className="flex flex-col gap-0.5">
      {Array.from({ length: sections.length }, (_, section) => (
        <div key={section} className={cn("flex flex-col gap-0.5", section > 0 && "mt-3")}>
          {headings ? (
            <div className="flex h-7 items-center px-1.5">
              <Skeleton className="h-2 w-10" />
            </div>
          ) : null}
          {Array.from({ length: sections[section] ?? 0 }, (_, row) => (
            <div key={row} className="flex h-7 items-center gap-2 ps-1.5 pe-2">
              <Skeleton className="size-4 shrink-0 rounded-full" />
              <Skeleton
                className={cn("h-2.5", TEXT_WIDTHS[(section * 3 + row) % TEXT_WIDTHS.length])}
              />
            </div>
          ))}
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** Otto: Stand-in `DataTable` rows: 44px, a 14px status, a title bar and a short time on the right. */
function SkeletonTableRows({
  label,
  rows = 8,
}: {
  readonly label: string;
  readonly rows?: number;
}) {
  return (
    <SkeletonRegion label={label} className="flex flex-col px-2 pt-1">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex h-11 items-center gap-2 px-2">
          <Skeleton className="size-3.5 shrink-0 rounded-full" />
          <Skeleton className={cn("h-2.5", TEXT_WIDTHS[row % TEXT_WIDTHS.length])} />
          <Skeleton className="ms-auto h-2.5 w-6 shrink-0" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** Otto: Stand-in `DataGrid` cards: a 16:9 tile with 8px corners and a title bar inset 16px. */
function SkeletonCards({ label, items = 6 }: { readonly label: string; readonly items?: number }) {
  return (
    <SkeletonRegion
      label={label}
      className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: items }, (_, item) => (
        <div key={item} className="flex flex-col gap-2.5">
          <Skeleton className="aspect-video w-full rounded-lg" />
          <div className="flex h-5 items-center px-4">
            <Skeleton className={cn("h-2.5", TEXT_WIDTHS[item % TEXT_WIDTHS.length])} />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

export { Skeleton, SkeletonCards, SkeletonSidebarRows, SkeletonTableRows };
