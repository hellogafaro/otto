import { ListFilterIcon, XIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Count } from "@workspace/ui/components/count"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "cn"

// Otto: list filters (Otto v1's set). There is NO toolbar: the page header
// carries a ghost Filter button (`FilterMenu`) next to Search and New, and the
// active filters show as chips under the header (`FilterBar`) ONLY while one is
// set. Filters combine: fields AND together, the values of one field OR
// together ("Status is any of Todo, Done" and "Labels is Research").

type FilterOption = {
  value: string
  label: string
  /** A 14px icon (a status icon, a label's dot). */
  icon?: React.ReactNode
  /** How many items it matches, shown softer after the label. */
  count?: number
}

type FilterField = {
  key: string
  label: string
  icon: React.ReactNode
  /** Its values (several can be on); none makes the field an on/off item. */
  options?: FilterOption[]
  count?: number
}

/** The values on per field; an on/off field is on with any value. */
type FilterValues = Partial<Record<string, string[]>>

/** A field's values with one value turned on or off. */
function toggleValue(values: string[] | undefined, value: string, on: boolean) {
  const rest = (values ?? []).filter((v) => v !== value)
  return on ? [...rest, value] : rest
}

// The checkable values of a field: in the Filter menu's submenu and in a
// chip's value menu. Picking one keeps the menu open, so several can be set.
function FilterOptionItems({
  field,
  values,
  onChange,
}: {
  field: FilterField
  values: FilterValues
  onChange: (key: string, values: string[]) => void
}) {
  return (field.options ?? []).map((option) => (
    <DropdownMenuCheckboxItem
      key={option.value}
      checked={values[field.key]?.includes(option.value) ?? false}
      onCheckedChange={(on) =>
        onChange(field.key, toggleValue(values[field.key], option.value, on))
      }
    >
      <FilterLabel icon={option.icon} count={option.count}>
        {option.label}
      </FilterLabel>
    </DropdownMenuCheckboxItem>
  ))
}

// Otto: the header's Filter button: a 28px ghost icon button, pressed while
// any filter is on, with its label in a tooltip. Its menu lists the fields: a
// field with values opens a submenu of checkable values (icon, label, count;
// the check is what is on); a field without values is an on/off item. Adding
// one never drops the others.
function FilterMenu({
  fields,
  values,
  onChange,
  label,
}: {
  fields: FilterField[]
  values: FilterValues
  onChange: (key: string, values: string[]) => void
  /** The button's accessible name and tooltip ("Filter chats"). */
  label: string
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
                  size="icon-compact"
                  aria-label={label}
                  aria-pressed={fields.some(({ key }) => values[key]?.length)}
                />
              }
            />
          }
        >
          <ListFilterIcon />
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          {fields.map((field) =>
            field.options ? (
              <DropdownMenuSub key={field.key}>
                <DropdownMenuSubTrigger>
                  {field.icon}
                  <span className="min-w-0 flex-1 truncate">{field.label}</span>
                  {values[field.key]?.length ? (
                    <Count>{values[field.key]?.length}</Count>
                  ) : null}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <FilterOptionItems
                    field={field}
                    values={values}
                    onChange={onChange}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuCheckboxItem
                key={field.key}
                checked={Boolean(values[field.key]?.length)}
                onCheckedChange={(on) => onChange(field.key, on ? ["true"] : [])}
              >
                <FilterLabel icon={field.icon} count={field.count}>
                  {field.label}
                </FilterLabel>
              </DropdownMenuCheckboxItem>
            )
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FilterLabel({
  icon,
  count,
  children,
}: {
  icon?: React.ReactNode
  count?: number
  children: React.ReactNode
}) {
  return (
    <>
      {icon && (
        <span className="flex w-3.5 shrink-0 items-center justify-center">
          {icon}
        </span>
      )}
      <span className="min-w-0 truncate">{children}</span>
      {count !== undefined && <Count>{count}</Count>}
    </>
  )
}

// Otto: the active filters, one 28px chip per field (`sm` 6, the outline
// button's card fill and hairline), split by hairlines: the field (icon and
// name, muted), the operator ("is", "is any of" with several values, muted),
// the values (their icons, then the labels joined by commas), which open the
// field's values to add or remove one, and a 28px × that removes the whole
// field. An on/off field is its name and the ×. Drawn only while a filter is
// set; the chips are 6px apart and wrap.
function FilterBar({
  fields,
  values,
  onChange,
  isLabel,
  isAnyOfLabel,
  removeLabel,
  className,
}: {
  fields: FilterField[]
  values: FilterValues
  onChange: (key: string, values: string[]) => void
  /** The operator for one value ("is") and for several ("is any of"). */
  isLabel: string
  isAnyOfLabel: string
  /** The × button's accessible name for a field ("Remove Status"). */
  removeLabel: (field: string) => string
  className?: string
}) {
  const active = fields.filter(({ key }) => values[key]?.length)
  if (active.length === 0) return null
  return (
    <div
      data-slot="filter-bar"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {active.map((field) => {
        const on = (field.options ?? []).filter((o) =>
          values[field.key]?.includes(o.value)
        )
        return (
          <div
            key={field.key}
            data-slot="filter-chip"
            className="flex h-7 max-w-full items-stretch divide-x divide-(--card-ring) overflow-hidden rounded-sm border border-(--card-ring) bg-card text-sm [&_svg:not([class*='size-'])]:size-3.5"
          >
            <span
              className={cn(
                "flex shrink-0 items-center gap-1.5 px-2",
                field.options ? "text-muted-foreground" : "text-foreground"
              )}
            >
              {field.icon}
              {field.label}
            </span>
            {field.options && (
              <>
                <span className="flex shrink-0 items-center px-2 text-muted-foreground">
                  {on.length > 1 ? isAnyOfLabel : isLabel}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger className="flex min-w-0 items-center gap-1.5 px-2 text-foreground transition-colors outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-expanded:bg-foreground/10">
                    {on.some((o) => o.icon) && (
                      <span className="flex shrink-0 items-center -space-x-0.5">
                        {on.map((o) => (
                          <span
                            key={o.value}
                            className="flex w-3.5 items-center justify-center"
                          >
                            {o.icon}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="truncate">
                      {on.map((o) => o.label).join(", ")}
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    <FilterOptionItems
                      field={field}
                      values={values}
                      onChange={onChange}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            <button
              type="button"
              aria-label={removeLabel(field.label)}
              onClick={() => onChange(field.key, [])}
              className="flex w-7 shrink-0 items-center justify-center text-muted-foreground transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-foreground/10"
            >
              <XIcon />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// Otto: nothing matches the search or the filters: the stock `Empty` (the
// filter icon in the 32px tile, a title, one line, then one way back such as
// "Clear filters"), centered both ways in the space left under the header and
// the filter bar; both stay. The page with nothing at all is the section's own
// empty state, not this.
function NoResults({
  title,
  description,
  children,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  /** One way back, such as an outline "Clear filters". */
  children?: React.ReactNode
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ListFilterIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children}
    </Empty>
  )
}

export { FilterBar, FilterMenu, NoResults }
export type { FilterField, FilterOption, FilterValues }
