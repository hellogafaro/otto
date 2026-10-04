import {
  type RemixiconComponentType,
  RiCloseLine,
  RiFilter3Line,
  RiPriceTag3Line,
} from "@remixicon/react";
import { Button } from "@workspace/ui/components/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@workspace/ui/components/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import type { Look } from "@/components/task-meta";

// List filters, shared by Tasks and Documents. Filters live in the URL; a
// missing key means any. Each property is a submenu of options with "Any"
// first; `people` menus put "Any" in the avatars' 20px slot.
export type FilterDef<K extends string> = {
  key: K;
  label: string;
  icon: RemixiconComponentType;
  options: Record<string, Look>;
  people?: boolean;
};

type FilterValues<K extends string> = Partial<Record<K, string>>;

// The filter menu, opened from the header's Filter button (pressed while
// any filter is on).
export function FilterMenu<K extends string>({
  filters,
  values,
  onChange,
}: {
  filters: FilterDef<K>[];
  values: FilterValues<K>;
  onChange: (key: K, value: string | undefined) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Filter"
                  aria-pressed={filters.some(({ key }) => values[key])}
                />
              }
            />
          }
        >
          <RiFilter3Line />
        </TooltipTrigger>
        <TooltipContent>Filter</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          {filters.map(({ key, label, icon: KeyIcon, options, people }) => (
            <DropdownMenuSub key={key}>
              <DropdownMenuSubTrigger>
                <KeyIcon />
                {label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuRadioGroup
                  value={values[key] ?? "any"}
                  onValueChange={(value) =>
                    onChange(key, value === "any" ? undefined : value)
                  }
                >
                  {/* "Any" shows the filter's icon, muted; in people menus it
                      takes the avatars' 20px slot so labels line up. */}
                  <DropdownMenuRadioItem value="any">
                    {people ? (
                      <span className="flex size-5 items-center justify-center">
                        <KeyIcon className="text-muted-foreground" />
                      </span>
                    ) : (
                      <KeyIcon className="text-muted-foreground" />
                    )}
                    Any
                  </DropdownMenuRadioItem>
                  {Object.entries(options).map(([value, look]) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      <look.icon className={look.className} />
                      {look.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Active filters, read-only: one 28px group each (property | value | ×),
// and Clear on the right. Changing filters happens in the Filter menu.
export function FilterBar<K extends string>({
  filters,
  values,
  onChange,
  onClear,
}: {
  filters: FilterDef<K>[];
  values: FilterValues<K>;
  onChange: (key: K, value: string | undefined) => void;
  onClear: () => void;
}) {
  const on = filters.filter(({ key }) => values[key]);
  if (on.length === 0) return null;
  return (
    <div className="-mt-2 flex flex-wrap items-center gap-2">
      {on.map(({ key, label, options }) => {
        const look = options[values[key] as string];
        return (
          <ButtonGroup key={key}>
            {/* Property, value, remove: joined segments with dividers; only
                the value shows an icon. */}
            <ButtonGroupText className="text-muted-foreground">
              {label}
            </ButtonGroupText>
            <ButtonGroupText>
              <look.icon className={look.className} />
              {look.label}
            </ButtonGroupText>
            <Button
              variant="outline"
              size="icon-compact"
              aria-label={`Remove ${label.toLowerCase()} filter`}
              onClick={() => onChange(key, undefined)}
            >
              <RiCloseLine />
            </Button>
          </ButtonGroup>
        );
      })}
      <Button
        variant="outline"
        size="compact"
        className="ml-auto"
        onClick={onClear}
      >
        Clear
      </Button>
    </div>
  );
}

// No matches: the empty state's shape, with a non-primary way back. The
// empty page is only for having nothing at all.
export function NoResults({
  what,
  onClear,
}: {
  /** What is listed, e.g. "tasks". */
  what: string;
  onClear: () => void;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RiFilter3Line />
        </EmptyMedia>
        <EmptyTitle>No results</EmptyTitle>
        <EmptyDescription>No {what} match these filters.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      </EmptyContent>
    </Empty>
  );
}

// A Label filter's options: every label in use, tag icons, A to Z.
export function labelLooks(labels: string[]): Record<string, Look> {
  return Object.fromEntries(
    [...new Set(labels)]
      .sort()
      .map((label) => [label, { label, icon: RiPriceTag3Line }]),
  );
}

// Takes a key out of a record (to list "Me" first in people menus).
export function omit<T>(record: Record<string, T>, key: string) {
  const { [key]: _omitted, ...rest } = record;
  return rest;
}
