import {
  type RemixiconComponentType,
  RiAddLine,
  RiArrowDownSLine,
  RiDeleteBinLine,
  RiLayoutRightLine,
  RiLinkM,
  RiMoreLine,
} from "@remixicon/react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxSearch,
} from "@workspace/ui/components/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Kbd } from "@workspace/ui/components/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import type { ComponentType, ReactElement } from "react";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { Page } from "@/components/page";
import { ActorAvatar, type Look } from "@/components/task-meta";
import { Topbar } from "@/components/topbar";

// Shared detail page: top bar (breadcrumb, More, panel toggle), the page
// (title, people row, body) and the right panel of properties.
export function DetailView({
  parent,
  current,
  title,
  cover,
  people,
  children,
  panel,
  ask,
}: {
  /** The section crumb: its icon, label and link (e.g. Tasks). */
  parent: { label: string; icon: RemixiconComponentType; link: ReactElement };
  /** The current item's crumb icon (its status). */
  current: { icon: ComponentType<{ className?: string }>; className?: string };
  title: string;
  /** A block above the title (a project's cover). */
  cover?: ReactNode;
  /** Owner, assignee or members under the title. */
  people: ReactNode;
  children?: ReactNode;
  panel: ReactNode;
  /** The floating Ask Otto bar, e.g. <AskOtto about="this task" />. */
  ask: ReactNode;
}) {
  return (
    <SidebarProvider className="min-h-0 flex-1 flex-col">
      <Topbar
        actions={
          <>
            <MoreMenu />
            <PanelToggle />
          </>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            {/* Crumbs are small ghost buttons with their icons, like the actions. */}
            <BreadcrumbItem>
              <BreadcrumbLink
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    nativeButton={false}
                    render={parent.link}
                  />
                }
              >
                <parent.icon data-icon="inline-start" />
                {parent.label}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <Button variant="ghost" size="sm" aria-current="page">
                <current.icon
                  data-icon="inline-start"
                  className={current.className}
                />
                <span className="truncate">{title}</span>
              </Button>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Topbar>

      <div className="flex min-h-0 flex-1">
        <SidebarInset>
          <Page title={title} cover={cover} floating={ask}>
            {/* -ml-2.25 puts the first avatar on the title's left edge (8px padding
                + 1px border). */}
            <div className="-mt-2 -ml-2.25 flex flex-wrap items-center gap-1 text-sm">
              {people}
            </div>
            {children}
          </Page>
        </SidebarInset>

        {/* The card's 1px ring is drawn outside its box and bar buttons paint
            inside a 1px transparent border, so pt-px and pr/pb-2.5 leave 9px of
            visible space on every side, like the rail and top bar buttons. */}
        <Sidebar
          side="right"
          variant="floating"
          className="top-12 max-h-[calc(100svh-3rem)] pt-px pr-2.5 pb-2.5"
        >
          {/* Notion-style: full-width dividers between collapsible sections. */}
          <SidebarContent className="gap-0">{panel}</SidebarContent>
        </Sidebar>
      </div>
    </SidebarProvider>
  );
}

// Page actions, kept to the main ones.
export function MoreMenu() {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="More" />
              }
            />
          }
        >
          <RiMoreLine />
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => navigator.clipboard.writeText(location.href)}
          >
            <RiLinkM />
            Copy link
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {/* Not wired yet. */}
          <DropdownMenuItem variant="destructive">
            <RiDeleteBinLine />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Opens and closes the right panel; always the rightmost top bar action.
export function PanelToggle() {
  const { open, toggleSidebar } = useSidebar();
  const label = open ? "Close panel" : "Open panel";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-expanded={open}
            onClick={toggleSidebar}
          />
        }
      >
        <RiLayoutRightLine />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// The quiet "New …" row that ends a sidebar list (the section's main action).
export function NewItem({
  label,
  children,
  ...props
}: { label: string } & ComponentProps<typeof SidebarMenuButton>) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton {...props}>
        <RiAddLine />
        <span>{label}</span>
      </SidebarMenuButton>
      {children}
    </SidebarMenuItem>
  );
}

export function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen render={<SidebarGroup />}>
      <SidebarGroupLabel
        render={<CollapsibleTrigger className="group/label" />}
      >
        {title}
        <span className="ml-auto flex items-center gap-2">
          {/* No count for an empty section (0 or none). */}
          {!!count && <span className="tabular-nums">{count}</span>}
          <RiArrowDownSLine className="-rotate-90 transition-transform group-data-panel-open/label:rotate-0" />
        </span>
      </SidebarGroupLabel>
      <CollapsibleContent>
        <SidebarMenu>{children}</SidebarMenu>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Keys typed into the description, comments or other fields never trigger shortcuts.
export function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest("input, textarea, [contenteditable=true]") !== null
  );
}

// Opens something from anywhere on the page with one key, unless typing.
export function useHotkey(hotkey: string | undefined, onPress: () => void) {
  const press = useRef(onPress);
  press.current = onPress;
  useEffect(() => {
    if (!hotkey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTyping(event.target)
      )
        return;
      if (event.key.toLowerCase() === hotkey) {
        event.preventDefault();
        press.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotkey]);
}

// Long lists: a stock combobox with a search field, anchored to its trigger.
export function ChoiceSearch<T extends string>({
  label,
  value,
  options,
  onPick,
  open,
  onOpenChange,
  anchor,
}: {
  label: string;
  value: T;
  options: Record<T, Look>;
  onPick: (value: T) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
}) {
  return (
    <Combobox
      autoHighlight
      items={Object.keys(options) as T[]}
      value={value}
      onValueChange={(next) => next && onPick(next as T)}
      open={open}
      onOpenChange={onOpenChange}
      itemToStringLabel={(key) => options[key as T].label}
    >
      <ComboboxContent anchor={anchor} className="w-56">
        <ComboboxSearch placeholder={`Search ${label.toLowerCase()}`} />
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>
          {(key: T) => {
            const look = options[key];
            return (
              <ComboboxItem key={key} value={key}>
                {/* 20px slot: avatars are 20px, so icons get the same column. */}
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <look.icon className={look.className} />
                </span>
                {look.label}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// Owner or assignee under the title: the person as a small ghost button with
// the Activity-size avatar; hover names the role. Opens a searchable list.
export function PersonPicker({
  label,
  value,
  options,
  onChange,
  hotkey,
}: {
  label: string;
  value: string;
  options: Record<string, Look>;
  onChange: (value: string) => void;
  hotkey: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const current = options[value];
  useHotkey(hotkey, () => setOpen(true));

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={anchor}
              variant="ghost"
              size="sm"
              aria-label={`${label}: ${current.label}`}
              onClick={() => setOpen(true)}
            />
          }
        >
          <ActorAvatar actorId={value} />
          {current.label}
        </TooltipTrigger>
        <TooltipContent>
          {label}
          <Kbd>{hotkey.toUpperCase()}</Kbd>
        </TooltipContent>
      </Tooltip>
      <ChoiceSearch
        label={label}
        value={value}
        options={options}
        onPick={(next) => {
          onChange(next);
          setOpen(false);
        }}
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
      />
    </>
  );
}

// One property row that opens a radio menu. `hotkey` opens it from anywhere
// on the page; inside, number keys pick an option (starting at `firstKey`).
export function ChoiceItem<T extends string>({
  label,
  value,
  options,
  onChange,
  hotkey,
  firstKey = 1,
  searchable = false,
  extra,
  plain = false,
}: {
  label: string;
  value: T;
  options: Record<T, Look>;
  onChange: (value: T) => void;
  hotkey?: string;
  firstKey?: number;
  /** Long lists: a stock combobox with a search field instead of number keys. */
  searchable?: boolean;
  /** Actions under the options (e.g. "Custom"), after a separator. */
  extra?: ReactNode;
  /** Menu items without icons, when every option shares the row's icon. */
  plain?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLLIElement>(null);
  const keys = Object.keys(options) as T[];
  const current = options[value];
  useHotkey(hotkey, () => setOpen(true));

  const pick = (next: T) => {
    onChange(next);
    setOpen(false);
  };

  if (searchable) {
    return (
      <SidebarMenuItem ref={anchor}>
        <SidebarMenuButton
          aria-label={`${label}: ${current.label}`}
          onClick={() => setOpen(true)}
        >
          <current.icon className={current.className} />
          <span>{current.label}</span>
        </SidebarMenuButton>
        <ChoiceSearch
          label={label}
          value={value}
          options={options}
          onPick={pick}
          open={open}
          onOpenChange={setOpen}
          anchor={anchor}
        />
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton aria-label={`${label}: ${current.label}`} />
          }
        >
          <current.icon className={current.className} />
          <span>{current.label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-52"
          onKeyDown={(event) => {
            const next = keys[Number(event.key) - firstKey];
            if (/^\d$/.test(event.key) && next) {
              event.preventDefault();
              pick(next);
            }
          }}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel shortcut={hotkey?.toUpperCase()}>
              Change {label.toLowerCase()}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={value}
              onValueChange={(next) => pick(next as T)}
            >
              {keys.map((option, index) => {
                const look = options[option];
                return (
                  <DropdownMenuRadioItem
                    key={option}
                    value={option}
                    shortcut={index + firstKey}
                  >
                    {!plain && <look.icon className={look.className} />}
                    {look.label}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {extra && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>{extra}</DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
