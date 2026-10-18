import { RiArrowUpDownLine, RiCloseLine, RiFilter3Line } from "@remixicon/react";
import type { ReactNode } from "react";

import { useI18n } from "../i18n";
import { Button } from "./ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export interface ListFilterOption {
  readonly value: string;
  readonly label: string;
  readonly icon?: ReactNode;
}

/** One typed filter a list allows: its choices and which of them are on. */
export interface ListFilter {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  /** Several choices widen the filter (any of them); otherwise one choice replaces another. */
  readonly multiple: boolean;
  readonly options: readonly ListFilterOption[];
  readonly selected: readonly string[];
  /** The chip's value when the choices alone do not name it, such as "2 statuses" or a date range. */
  readonly selectedLabel?: string;
  readonly onChange: (selected: readonly string[]) => void;
}

export interface ListSort<Sort extends string> {
  readonly options: ReadonlyArray<{ readonly value: Sort; readonly label: string }>;
  readonly value: Sort;
  readonly order: "asc" | "desc";
  readonly onChange: (sort: Sort, order: "asc" | "desc") => void;
}

function FilterOptions({ filter }: { readonly filter: ListFilter }) {
  return filter.options.map((option) => (
    <MenuCheckboxItem
      key={option.value}
      checked={filter.selected.includes(option.value)}
      onCheckedChange={(checked) =>
        filter.onChange(
          filter.multiple
            ? checked
              ? [...filter.selected, option.value]
              : filter.selected.filter((value) => value !== option.value)
            : checked
              ? [option.value]
              : [],
        )
      }
    >
      <span className="flex min-w-0 items-center gap-2">
        {option.icon}
        <span className="truncate">{option.label}</span>
      </span>
    </MenuCheckboxItem>
  ));
}

/** A quiet 28px top-bar icon button that opens a menu, named by its tooltip. */
function TopBarMenu({
  label,
  icon,
  align = "end",
  children,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly align?: "start" | "end";
  readonly children: ReactNode;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button size="icon-sm" variant="ghost-muted" aria-label={label}>
                  {icon}
                </Button>
              }
            />
          }
        />
        <TooltipPopup side="bottom">{label}</TooltipPopup>
      </Tooltip>
      <MenuPopup align={align}>{children}</MenuPopup>
    </Menu>
  );
}

/** Otto: The top bar's Filter action: one submenu of choices per filter the list allows. */
export function ListFilterMenu({ filters }: { readonly filters: readonly ListFilter[] }) {
  const { t } = useI18n();

  return (
    <TopBarMenu label={t("Filter")} icon={<RiFilter3Line aria-hidden className="size-4" />}>
      {filters.map((filter) => (
        <MenuSub key={filter.id}>
          <MenuSubTrigger>
            {filter.icon}
            {filter.label}
          </MenuSubTrigger>
          <MenuSubPopup>
            <FilterOptions filter={filter} />
          </MenuSubPopup>
        </MenuSub>
      ))}
    </TopBarMenu>
  );
}

/** Otto: The top bar's Sort action: Sort by, then the order. */
export function ListSortMenu<Sort extends string>({ sort }: { readonly sort: ListSort<Sort> }) {
  const { t } = useI18n();

  return (
    <TopBarMenu label={t("Sort")} icon={<RiArrowUpDownLine aria-hidden className="size-4" />}>
      <MenuGroup>
        <MenuGroupLabel>{t("Sort by")}</MenuGroupLabel>
        <MenuRadioGroup
          value={sort.value}
          onValueChange={(value: Sort) => sort.onChange(value, sort.order)}
        >
          {sort.options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuGroup>
      <MenuSeparator />
      <MenuRadioGroup
        value={sort.order}
        onValueChange={(order: "asc" | "desc") => sort.onChange(sort.value, order)}
      >
        <MenuRadioItem value="asc">{t("Ascending")}</MenuRadioItem>
        <MenuRadioItem value="desc">{t("Descending")}</MenuRadioItem>
      </MenuRadioGroup>
    </TopBarMenu>
  );
}

const SEGMENT = "flex h-full items-center gap-1.5 px-2 [&_svg]:size-3.5 [&_svg]:shrink-0";

const SEGMENT_BUTTON = `${SEGMENT} cursor-pointer outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`;

/**
 * Otto: The filters that are on, after Linear and Capy: one card with each filter inline as a
 * 28px button group (field, is or is any of, the value, a close) and Clear at the right. The
 * value opens its choices right there. It shows only while a filter is on.
 */
export function ListFilterBar({
  filters,
  onClear,
}: {
  readonly filters: readonly ListFilter[];
  readonly onClear: () => void;
}) {
  const { t } = useI18n();
  const active = filters.filter((filter) => filter.selected.length > 0);

  if (active.length === 0) return null;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-card p-1.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {active.map((filter) => (
          <div
            key={filter.id}
            className="inline-flex h-7 max-w-full items-center divide-x divide-control-border overflow-hidden rounded-md border border-control-border bg-control text-xs shadow-control"
          >
            <span className={`${SEGMENT} text-foreground [&_svg]:text-muted-foreground`}>
              {filter.icon}
              {filter.label}
            </span>
            <span className={`${SEGMENT} text-muted-foreground`}>
              {filter.selected.length > 1 ? t("is any of") : t("is")}
            </span>
            <Menu>
              <MenuTrigger
                render={<button type="button" className={`${SEGMENT_BUTTON} min-w-0`} />}
              >
                <span className="truncate text-foreground">
                  {filter.selectedLabel ??
                    filter.options.find((option) => filter.selected.includes(option.value))?.label}
                </span>
              </MenuTrigger>
              <MenuPopup align="start">
                <FilterOptions filter={filter} />
              </MenuPopup>
            </Menu>
            <button
              type="button"
              aria-label={t("Remove {filter} filter", { filter: filter.label })}
              onClick={() => filter.onChange([])}
              className={`${SEGMENT_BUTTON} w-7 justify-center px-0 text-muted-foreground hover:text-foreground`}
            >
              <RiCloseLine aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="ghost-muted" onClick={onClear}>
        {t("Clear")}
      </Button>
    </div>
  );
}
