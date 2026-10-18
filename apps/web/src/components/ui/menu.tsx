"use client";

import { RiArrowRightSLine, RiCheckLine } from "@remixicon/react";
import { Predicate } from "effect";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { createContext, use } from "react";
import type * as React from "react";

import { Kbd } from "~/components/ui/kbd";
import { useI18n } from "~/i18n";
import { cn } from "~/lib/utils";

const MenuCreateHandle = MenuPrimitive.createHandle;

const MenuFilterableContext = createContext(true);

// Otto: Every menu filters its items as you type, like Linear's; a menu of plain buttons opts out.
function Menu({
  filterable = true,
  ...props
}: MenuPrimitive.Root.Props & { filterable?: boolean }) {
  return filterable ? (
    <MenuPrimitive.FilterProvider autoHighlight>
      <MenuFilterableContext value>
        <MenuPrimitive.Root {...props} />
      </MenuFilterableContext>
    </MenuPrimitive.FilterProvider>
  ) : (
    <MenuFilterableContext value={false}>
      <MenuPrimitive.Root {...props} />
    </MenuFilterableContext>
  );
}

const MenuPortal = MenuPrimitive.Portal;

function MenuTrigger({ className, children, ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger className={className} data-slot="menu-trigger" {...props}>
      {children}
    </MenuPrimitive.Trigger>
  );
}

// Otto: With an empty filter, 1–9 and 0 pick the first ten choice rows; once you type, digits filter.
function activateItemByKey(event: React.KeyboardEvent<HTMLInputElement>) {
  const { altKey, ctrlKey, currentTarget, key, metaKey } = event;

  if (currentTarget.value || altKey || ctrlKey || metaKey || !/^\d$/.test(key)) return;

  event.preventDefault();
  const keys = currentTarget.parentElement?.querySelectorAll("[data-slot=menu-key]:not([hidden])");
  const item = keys?.[(Number(key) + 9) % 10]?.parentElement;

  if (item && !item.hasAttribute("data-disabled")) item.click();
}

// Otto: Choice rows are numbered 1–9 then 0 in the shared Kbd; later rows get no key.
function numberMenuKeys(list: HTMLDivElement | null) {
  if (!list) return;

  const number = () =>
    list.querySelectorAll("[data-slot=menu-key]").forEach((key, index) => {
      const label = index < 10 ? String((index + 1) % 10) : "";
      const cap = key.firstElementChild;

      if (cap && cap.textContent !== label) cap.textContent = label;
      key.toggleAttribute("hidden", index >= 10);
    });

  const observer = new MutationObserver(number);

  number();
  observer.observe(list, { childList: true, subtree: true });

  return () => observer.disconnect();
}

// Otto: Only choice rows (radio and checkbox) get keys, and not in submenus or the reaction picker;
// action rows show their command's own shortcut through MenuShortcut instead.
function MenuKey({ className }: { className?: string }) {
  if (!use(MenuFilterableContext)) return null;

  return (
    <span
      aria-hidden
      className={cn(
        "-me-0.5 sm:-me-1 ms-auto flex shrink-0 ps-4 group-has-[[data-slot=menu-filter]:not(:placeholder-shown)]/menu:hidden",
        className,
      )}
      data-slot="menu-key"
    >
      <Kbd />
    </span>
  );
}

function MenuPopup({
  children,
  className,
  // Otto: Every popup opens 6px from its trigger, the panel gap, so it never touches it.
  sideOffset = 6,
  align = "center",
  alignOffset,
  side = "bottom",
  anchor,
  presentation,
  ...props
}: MenuPrimitive.Popup.Props & {
  /** "padded" adds an outer inset, used by the compact reaction picker. */
  presentation?: "padded";
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  side?: MenuPrimitive.Positioner.Props["side"];
  anchor?: MenuPrimitive.Positioner.Props["anchor"];
}) {
  const { t } = useI18n();
  const filterable = use(MenuFilterableContext);

  const hasExplicitWidthClass =
    Predicate.isString(className) &&
    className.split(/\s+/).some((classToken) => {
      const utility = classToken.split(":").at(-1) ?? classToken;

      return /^(?:min-|max-)?w-/.test(utility);
    });

  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-[130]"
        data-slot="menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn(
            "group/menu relative flex origin-(--transform-origin) flex-col rounded-lg border border-border/80 bg-popover shadow-[0_18px_48px_-24px_rgb(0_0_0/55%)] outline-none focus:outline-none dark:shadow-[0_22px_56px_-24px_rgb(0_0_0/80%)]",
            !hasExplicitWidthClass && "min-w-32",
            presentation === "padded" && "p-1",
            className,
          )}
          data-slot="menu-popup"
          {...props}
        >
          {filterable ? (
            <>
              {/* Otto: The filter stays out of sight until you type, then heads the popup. */}
              <MenuPrimitive.Input
                aria-label={t("Filter")}
                className="h-8 w-full shrink-0 border-border border-b bg-transparent px-3 text-base text-foreground outline-none placeholder-shown:sr-only sm:h-7 sm:text-sm"
                data-slot="menu-filter"
                placeholder={t("Filter")}
                onKeyDown={activateItemByKey}
              />
              <MenuPrimitive.Empty className="px-3 py-1.5 text-base text-muted-foreground group-has-[[data-slot=menu-filter]:placeholder-shown]/menu:hidden sm:text-sm">
                {t("No results")}
              </MenuPrimitive.Empty>
              {/* Otto: While filtering, only matching items show, without headers or separators. */}
              <MenuPrimitive.List
                ref={numberMenuKeys}
                className="max-h-(--available-height) w-full overflow-y-auto p-1 group-has-[[data-slot=menu-filter]:not(:placeholder-shown)]/menu:[&>:not([role^=menuitem],[role=group])]:hidden"
              >
                {children}
              </MenuPrimitive.List>
            </>
          ) : (
            <div className="max-h-(--available-height) w-full overflow-y-auto p-1">{children}</div>
          )}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function MenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="menu-group" {...props} />;
}

function MenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    // Otto: Menu rows are 28px on desktop, like radio, checkbox and submenu rows. A command's
    // shortcut caps sit 24px from the label and as far from the right edge as from the top.
    <MenuPrimitive.Item
      className={cn(
        "[&>svg]:-mx-0.5 [&>[data-slot=kbd-group]]:-me-0.5 sm:[&>[data-slot=kbd-group]]:-me-1 [&>[data-slot=kbd-group]]:ps-4 flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 text-base text-foreground outline-none data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-highlighted:bg-secondary data-inset:ps-8 data-[variant=destructive]:text-destructive-foreground data-highlighted:text-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&>svg:not([class*='opacity-'])]:opacity-70 [&>svg:not([class*='size-'])]:size-4.5 sm:[&>svg:not([class*='size-'])]:size-4 [&>svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:[&>svg:not([class*='text-'])]:text-current [&>svg]:pointer-events-none [&>svg]:shrink-0",
        className,
      )}
      data-inset={inset}
      data-slot="menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

function MenuCheckboxItem({
  className,
  children,
  checked,
  variant = "default",
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  variant?: "default" | "switch";
}) {
  return (
    <MenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        "grid min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-pointer items-center gap-2 rounded-md py-1 ps-2.5 text-base text-foreground outline-none data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        // Otto: the check sits at the right end of the row, so labels and avatars stay aligned.
        variant === "switch"
          ? "grid-cols-[1fr_auto_auto] gap-4 pe-1.5"
          : "grid-cols-[1fr_1rem_auto] pe-2",
        className,
      )}
      data-slot="menu-checkbox-item"
      {...props}
    >
      {variant === "switch" ? (
        <>
          <span className="col-start-1">{children}</span>
          <MenuPrimitive.CheckboxItemIndicator
            className="inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 items-center rounded-full p-px outline-none transition-[background-color,box-shadow] duration-200 [--thumb-size:--spacing(4)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-message-action data-unchecked:bg-input data-disabled:opacity-64 sm:[--thumb-size:--spacing(3)]"
            keepMounted
          >
            <span className="pointer-events-none block aspect-square h-full in-[[data-slot=menu-checkbox-item][data-checked]]:origin-[var(--thumb-size)_50%] origin-left in-[[data-slot=menu-checkbox-item][data-checked]]:translate-x-[calc(var(--thumb-size)-4px)] in-[[data-slot=menu-checkbox-item]:active]:not-data-disabled:scale-x-110 in-[[data-slot=menu-checkbox-item]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.10)] rounded-(--thumb-size) bg-on-solid shadow-sm/5 will-change-transform [transition:translate_.15s,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s]" />
          </MenuPrimitive.CheckboxItemIndicator>
        </>
      ) : (
        <>
          <span className="col-start-1 min-w-0">{children}</span>
          <MenuPrimitive.CheckboxItemIndicator className="col-start-2">
            <RiCheckLine aria-hidden="true" />
          </MenuPrimitive.CheckboxItemIndicator>
        </>
      )}
      <MenuKey className="col-start-3" />
    </MenuPrimitive.CheckboxItem>
  );
}

function MenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="menu-radio-group" {...props} />;
}

function MenuRadioItem({
  className,
  children,
  hideIndicator: _hideIndicator = false,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  hideIndicator?: boolean;
}) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(
        "[&_svg]:-mx-0.5 flex min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-base text-foreground outline-none data-checked:bg-foreground/[0.08] data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      data-slot="menu-radio-item"
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <MenuKey />
    </MenuPrimitive.RadioItem>
  );
}

function MenuGroupLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.GroupLabel
      className={cn(
        "px-2 py-1.5 font-medium text-muted-foreground text-xs data-inset:ps-9 group-has-[[data-slot=menu-filter]:not(:placeholder-shown)]/menu:hidden sm:data-inset:ps-8",
        className,
      )}
      data-inset={inset}
      data-slot="menu-label"
      {...props}
    />
  );
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    // Otto: Separators run the popup's full width, past its 4px padding.
    <MenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      data-slot="menu-separator"
      {...props}
    />
  );
}

function MenuSub(props: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="menu-sub" {...props} />;
}

function MenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
}) {
  return (
    // Otto: A leading glyph sits and fades like a menu item's, so submenu rows line up with items.
    // A row's key caps take the free space, and the chevron then sits 4px after them.
    <MenuPrimitive.SubmenuTrigger
      className={cn(
        "[&>svg:first-child]:-mx-0.5 [&>svg:first-child:not([class*='opacity-'])]:opacity-70 flex min-h-8 items-center gap-2 rounded-sm px-2 py-1 text-base text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-popup-open:bg-accent data-inset:ps-8 data-highlighted:text-accent-foreground data-popup-open:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none",
        className,
      )}
      data-inset={inset}
      data-slot="menu-sub-trigger"
      {...props}
    >
      {children}
      <RiArrowRightSLine className="-me-0.5 ms-auto opacity-80 [[data-slot=kbd-group]~&]:-ms-1" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

function MenuSubPopup({
  className,
  sideOffset = 0,
  alignOffset,
  align = "start",
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
}) {
  const defaultAlignOffset = align !== "center" ? -5 : undefined;

  return (
    <MenuFilterableContext value={false}>
      <MenuPopup
        align={align}
        alignOffset={alignOffset ?? defaultAlignOffset}
        className={className}
        data-slot="menu-sub-content"
        side="inline-end"
        sideOffset={sideOffset}
        {...props}
      />
    </MenuFilterableContext>
  );
}

export {
  MenuCreateHandle,
  MenuCreateHandle as DropdownMenuCreateHandle,
  Menu,
  Menu as DropdownMenu,
  MenuPortal,
  MenuPortal as DropdownMenuPortal,
  MenuTrigger,
  MenuTrigger as DropdownMenuTrigger,
  MenuPopup,
  MenuPopup as DropdownMenuContent,
  MenuGroup,
  MenuGroup as DropdownMenuGroup,
  MenuItem,
  MenuItem as DropdownMenuItem,
  MenuCheckboxItem,
  MenuCheckboxItem as DropdownMenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioGroup as DropdownMenuRadioGroup,
  MenuRadioItem,
  MenuRadioItem as DropdownMenuRadioItem,
  MenuGroupLabel,
  MenuGroupLabel as DropdownMenuLabel,
  MenuSeparator,
  MenuSeparator as DropdownMenuSeparator,
  MenuSub,
  MenuSub as DropdownMenuSub,
  MenuSubTrigger,
  MenuSubTrigger as DropdownMenuSubTrigger,
  MenuSubPopup,
  MenuSubPopup as DropdownMenuSubContent,
};
