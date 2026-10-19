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

const DEFAULT_SETTINGS_SECTIONS = [3, 2] as const;

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
    <SkeletonRegion label={label} className="flex flex-col pt-1">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex h-11 items-center gap-2 px-4">
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

/**
 * Otto: Stand-in settings sections: a 15px title bar 12px above a card of rows, each row a label
 * and description bar on the left and a 28px control on the right, so loaded cards land in place.
 */
function SkeletonSettingsSections({
  label,
  sections = DEFAULT_SETTINGS_SECTIONS,
  headings = true,
}: {
  readonly label: string;
  /** Rows per section. */
  readonly sections?: readonly number[];
  /** Whether each section starts with a title bar. */
  readonly headings?: boolean;
}) {
  return (
    <SkeletonRegion label={label} className="flex flex-col gap-10">
      {Array.from({ length: sections.length }, (_, section) => (
        <div key={section} className="flex flex-col gap-3">
          {headings ? (
            <div className="flex h-7 items-center">
              <Skeleton className="h-3 w-28" />
            </div>
          ) : null}
          <div className="divide-y divide-border/50 rounded-lg border border-border/70 bg-settings-surface">
            {Array.from({ length: sections[section] ?? 0 }, (_, row) => (
              <div key={row} className="flex items-center gap-4 p-4">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton
                    className={cn("h-2.5", TEXT_WIDTHS[(section * 3 + row) % TEXT_WIDTHS.length])}
                  />
                  <Skeleton className="h-2 w-1/2" tone="faint" />
                </div>
                <Skeleton className="h-7 w-28 shrink-0 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

/**
 * Otto: Stand-in command palette results in their geometry: a 28px group label, then 44px rows
 * with a 16px glyph, a title bar and a shorter context bar, so results land where these were.
 */
function SkeletonPaletteRows({
  label,
  rows = 3,
}: {
  readonly label: string;
  readonly rows?: number;
}) {
  return (
    <SkeletonRegion label={label} className="flex flex-col p-2">
      <div className="flex h-7 items-center ps-2.25">
        <Skeleton className="h-2 w-10" />
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex h-11 items-center gap-2 px-2">
          <Skeleton className="size-4 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-2.5", TEXT_WIDTHS[row % TEXT_WIDTHS.length])} />
            <Skeleton className="h-2 w-1/4" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** Otto: Stand-in app rows: a 32px logo tile, a name, a detail and a chevron, in one card. */
function SkeletonCustomizeRows({
  label,
  rows = 6,
}: {
  readonly label: string;
  readonly rows?: number;
}) {
  return (
    <SkeletonRegion label={label}>
      <div className="divide-y divide-border/50 rounded-lg border border-border/70 bg-settings-surface">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-8 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className={cn("h-2.5", TEXT_WIDTHS[row % TEXT_WIDTHS.length])} />
              <Skeleton className="h-2 w-1/2" tone="faint" />
            </div>
            <Skeleton className="size-4 shrink-0" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Otto: Stand-in Yours and Team cards: a title, a count row and app rows. */
function SkeletonIntegrationGroups({ label }: { readonly label: string }) {
  return (
    <SkeletonRegion label={label} className="flex flex-col gap-10">
      {Array.from({ length: 2 }, (_, section) => (
        <div key={section} className="flex flex-col gap-3">
          <div className="flex h-7 items-center">
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="divide-y divide-border/50 rounded-lg border border-border/70 bg-settings-surface">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="size-7 shrink-0 rounded-md" />
            </div>
            {Array.from({ length: 2 }, (_, row) => (
              <div key={row} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-8 shrink-0 rounded-md" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton
                    className={cn("h-2.5", TEXT_WIDTHS[(section + row) % TEXT_WIDTHS.length])}
                  />
                  <Skeleton className="h-2 w-1/3" tone="faint" />
                </div>
                <Skeleton className="size-4 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** Otto: Stand-in app page: the 40px logo and name, then two groups of rows. */
function SkeletonAppDetail({ label }: { readonly label: string }) {
  return (
    <SkeletonRegion label={label} className="flex flex-col gap-10">
      <div className="flex items-center gap-4">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-2.5 w-2/3" tone="faint" />
        </div>
      </div>
      {[2, 4].map((rows, section) => (
        <div key={section} className="flex flex-col gap-3">
          <div className="flex h-7 items-center">
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="divide-y divide-border/50 rounded-lg border border-border/70 bg-settings-surface">
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-8 shrink-0 rounded-md" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className={cn("h-2.5", TEXT_WIDTHS[row % TEXT_WIDTHS.length])} />
                  <Skeleton className="h-2 w-1/2" tone="faint" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

export {
  Skeleton,
  SkeletonAppDetail,
  SkeletonCards,
  SkeletonCustomizeRows,
  SkeletonIntegrationGroups,
  SkeletonPaletteRows,
  SkeletonRegion,
  SkeletonSettingsSections,
  SkeletonSidebarRows,
  SkeletonTableRows,
};
