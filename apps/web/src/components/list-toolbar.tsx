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
  /** The chip's text when a choice is on that the options do not list, such as a date range. */
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

/**
 * Otto: A list's toolbar, after Linear's filter bar. Each filter that is on is a 28px chip (its
 * name muted, then its choices) that reopens its choices, with a close button that clears it;
 * Filter adds one from a menu of the list's filters, and the sort menu sits at the right.
 */
export function ListToolbar<Sort extends string>({
  filters,
  sort,
}: {
  readonly filters: readonly ListFilter[];
  readonly sort: ListSort<Sort>;
}) {
  const { t } = useI18n();
  const active = filters.filter((filter) => filter.selected.length > 0);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {active.map((filter) => (
        <div
          key={filter.id}
          className="inline-flex h-7 max-w-full items-center rounded-md border border-control-border bg-control text-xs shadow-control"
        >
          <Menu>
            <MenuTrigger
              render={
                <button
                  type="button"
                  className="flex h-full min-w-0 cursor-pointer items-center gap-1.5 rounded-s-md ps-2 pe-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
                />
              }
            >
              {filter.icon}
              <span className="text-muted-foreground">{filter.label}</span>
              <span className="truncate text-foreground">
                {filter.selectedLabel ??
                  filter.options
                    .filter((option) => filter.selected.includes(option.value))
                    .map((option) => option.label)
                    .join(", ")}
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
            className="flex h-full w-6 shrink-0 cursor-pointer items-center justify-center rounded-e-md border-s border-control-border text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
          >
            <RiCloseLine aria-hidden />
          </button>
        </div>
      ))}
      <Menu>
        <MenuTrigger
          render={
            <Button size="sm" variant="ghost-muted">
              <RiFilter3Line aria-hidden />
              {t("Filter")}
            </Button>
          }
        />
        <MenuPopup align="start">
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
        </MenuPopup>
      </Menu>
      <Menu>
        <MenuTrigger
          render={
            <Button size="sm" variant="ghost-muted" className="ms-auto">
              <RiArrowUpDownLine aria-hidden />
              {sort.options.find((option) => option.value === sort.value)?.label}
            </Button>
          }
        />
        <MenuPopup align="end">
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
        </MenuPopup>
      </Menu>
    </div>
  );
}
