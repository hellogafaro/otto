"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

const buttonPresentations = {
  "toolbar-toggle-on": "bg-accent text-foreground",
  "toolbar-sticky": "bg-background/95",
  "composer-control":
    "gap-1.5 rounded-(--control-radius) px-2.5 text-secondary-label transition-none hover:text-foreground",
  // A composer picker trigger placed in a settings row, in near-full foreground ink.
  "composer-control-settings-row":
    "gap-1.5 rounded-(--control-radius) px-2.5 text-foreground/90 transition-none hover:text-foreground",
  "stash-badge": "gap-1 px-1.5",
  "stash-badge-active": "gap-1 px-1.5 [--control-icon-color:currentColor] text-foreground",
  "approval-accept":
    "font-medium bg-foreground text-background [:active,[data-pressed]]:bg-foreground/80 [:hover,[data-pressed]]:bg-foreground/90",
  "approval-always":
    "font-medium border-border bg-muted/40 text-foreground [:hover,[data-pressed]]:bg-muted/70",
  "approval-other": "font-medium text-muted-foreground [:hover,[data-pressed]]:text-foreground",
  "image-nav": "text-on-solid/90 hover:bg-on-solid/10 hover:text-on-solid",
  // Otto: Reaction emoji sit in the message toolbar's 24px buttons at body size.
  "reaction-emoji": "text-base sm:text-base font-emoji",
  "model-favorite-toggle":
    "text-muted-foreground/70 opacity-64 transition-color-opacity hover:text-foreground hover:opacity-100 group-hover:opacity-100",
  "model-favorite-toggle-on":
    "text-muted-foreground/70 opacity-64 transition-color-opacity hover:text-foreground hover:opacity-100 group-hover:opacity-100 text-foreground opacity-100",
  "muted-dismiss": "text-muted-foreground hover:text-foreground",
  // Otto: A secondary text action under a form, such as Forgot password.
  "quiet-link":
    "h-auto self-start border-0 px-0 text-13px font-normal text-muted-foreground hover:text-foreground sm:text-13px",
  "markdown-chrome": "chat-markdown-chrome-action",
  "reveal-on-hover":
    "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100",
  // Otto: A card's or row's actions menu, shown while the card is hovered or focused or the menu is open.
  "reveal-in-group":
    "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-popup-open:opacity-100 max-sm:opacity-100",
  "preview-tool": "[:hover,[data-pressed]]:bg-foreground/10",
  "screen-reveal":
    "opacity-0 transition group-focus-within/screen:opacity-100 group-hover/screen:opacity-100",
  "text-xs": "text-xs",
  "update-pill-dismiss":
    "[--control-icon-color:currentColor] rounded-md text-inherit opacity-70 hover:bg-transparent hover:opacity-100",
  "provider-update-strong": "size-5 rounded-sm p-0 text-warning hover:text-warning",
  "provider-update": "size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground",
  "model-favorite": "text-favorite-foreground hover:text-favorite-hover-foreground",
  "compact-gap": "gap-1",
  "wizard-preview-action": "h-7 px-2 text-xs text-muted-foreground",
  "environment-add": "h-7 gap-1.5 px-2 text-xs",
  "environment-remove": "size-8 text-muted-foreground hover:text-destructive",
  "model-visibility": "text-muted-foreground/60 hover:text-muted-foreground",
  "channel-disclosure": "size-7 shrink-0 text-muted-foreground hover:text-foreground sm:size-7",
  "provider-remove": "text-muted-foreground hover:text-destructive",
  "provider-email-copy":
    "size-6 shrink-0 rounded-sm p-0 text-muted-foreground hover:text-foreground",
  "wizard-step":
    "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring max-sm:justify-center max-sm:px-2",
  "wizard-step-current":
    "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring max-sm:justify-center max-sm:px-2 bg-card text-foreground shadow-xs ring-1 ring-tint/5 hover:bg-card dark:shadow-none dark:ring-tint/5",
};

const buttonVariants = cva(
  "[--control-icon-color:currentColor] [&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--control-radius)] border font-medium text-base outline-none transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--control-radius)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 sm:text-sm [&_svg:not([class*='text-'])]:text-[var(--control-icon-color)] [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        compact:
          "h-7 gap-1 rounded-md px-[calc(--spacing(2)-1px)] text-xs before:rounded-[calc(var(--radius-md)-1px)] [&_svg:not([class*='size-'])]:size-3.5",
        // Wraps an avatar or avatar tile: the child sets the size.
        avatar: "p-0",
        // Otto: One step of a top-bar path, glyph then title: the glyph sits 6px in and 4px from the title.
        crumb: "h-7 gap-1.5 px-2 text-13px sm:text-13px",
        // Otto: A sub page's 13px back title in the top bar, chevron then title.
        "back-title": "h-7 gap-1 px-[calc(--spacing(1.5)-1px)] text-13px sm:text-13px",
        // Otto: A default button in a settings row or a dialog footer matches the 28px controls.
        default:
          "h-8 px-[calc(--spacing(3)-1px)] in-data-[slot=settings-control]:h-7 in-data-[slot=settings-control]:px-[calc(--spacing(2.5)-1px)] in-data-[slot=dialog-footer]:h-7 in-data-[slot=dialog-footer]:px-[calc(--spacing(2.5)-1px)] in-data-[slot=alert-dialog-footer]:h-7 in-data-[slot=alert-dialog-footer]:px-[calc(--spacing(2.5)-1px)]",
        icon: "size-8",
        "icon-lg": "size-9",
        "icon-micro":
          "size-5 rounded-sm p-0 before:rounded-[calc(var(--radius-sm)-1px)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-sm-round": "size-7 rounded-full",
        "icon-xl": "size-10 [&_svg:not([class*='size-'])]:size-4.5",
        // Otto: a 24px icon button nested 2px inside a 28px row, its 4px radius concentric with the row's 6px.
        "icon-row":
          "size-6 rounded-sm before:rounded-[calc(var(--radius-sm)-1px)] not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-4 sm:not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs":
          "size-6 not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-4 sm:not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 px-[calc(--spacing(3.5)-1px)]",
        /** Full-width sheet row whose label lines up with the sheet's other row labels. */
        row: "h-7 gap-1.5 px-2",
        /** `row` with roomier gaps and regular weight, for list entries with trailing meta. */
        "row-relaxed": "h-7 gap-3 px-2 font-normal",
        micro:
          "h-5 gap-1 rounded-sm px-[calc(--spacing(1.5)-1px)] text-[11px] before:rounded-[calc(var(--radius-sm)-1px)] sm:text-[11px] [&_svg:not([class*='size-'])]:size-3 sm:[&_svg:not([class*='size-'])]:size-3",
        onboarding: "h-8 rounded-xl px-[calc(--spacing(3)-1px)]",
        pill: "h-7 gap-1.5 rounded-full px-3.5 text-[13px]",
        "pill-dense": "h-7 gap-1.5 rounded-full px-3 text-xs",
        "pill-short": "h-7 gap-1.5 rounded-full px-[calc(--spacing(2.5)-1px)]",
        sm: "h-7 gap-1.5 px-[calc(--spacing(2.5)-1px)]",
        xl: "h-10 px-[calc(--spacing(4)-1px)] text-lg sm:text-base [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
        xs: "h-6 gap-1 px-[calc(--spacing(2)-1px)] text-sm sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        // Otto: Solid actions keep sky fills and white labels in both appearances.
        primary:
          "border-transparent bg-(--primary-button-background) text-(--primary-button-foreground) [:hover,[data-pressed]]:opacity-92 focus-visible:ring-ring",
        // A bare avatar with an edit badge; its focus ring hugs the rounded avatar.
        "avatar-edit":
          "inline-block rounded-2xl border-0 transition-none focus-visible:ring-offset-0 [&_svg]:mx-0",
        // A square pickable avatar tile; aria-pressed marks the chosen one.
        "avatar-tile":
          "rounded-xl border-transparent transition-colors focus-visible:ring-foreground/20 focus-visible:ring-offset-0 not-aria-pressed:hover:bg-secondary/70 aria-pressed:border-border aria-pressed:bg-secondary [&_svg]:mx-0",
        "keybinding-action":
          "[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent text-muted-foreground hover:text-foreground",
        default:
          "border-transparent bg-foreground text-background [:active,[data-pressed]]:bg-foreground/80 [:hover,[data-pressed]]:bg-foreground/88",
        // Primary action that turns into a quiet muted block while disabled.
        "default-muted-disabled":
          "border-transparent bg-foreground text-background disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 [:active,[data-pressed]]:bg-foreground/80 [:hover,[data-pressed]]:bg-foreground/88",
        destructive:
          "border-transparent bg-destructive text-on-solid [:active,[data-pressed]]:bg-destructive/80 [:hover,[data-pressed]]:bg-destructive/90",
        "destructive-outline":
          "border-transparent bg-secondary text-destructive-foreground [:hover,[data-pressed]]:bg-destructive/12",
        ghost:
          "[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent",
        "ghost-destructive":
          "[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-destructive data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent",
        "ghost-muted":
          "[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-muted-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent [:hover,[data-pressed]]:text-foreground",
        /** Quiet sheet row; the hover fill marks it without changing its color. */
        "ghost-quiet":
          "[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-muted-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent",
        /** The selected `ghost-quiet` row. */
        "ghost-current":
          "[--control-icon-color:var(--contrast-muted-foreground)] border-transparent bg-muted text-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent",
        glass:
          "surface-glass [--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-foreground [:hover,[data-pressed]]:bg-accent/60",
        link: "border-transparent underline-offset-4 [:hover,[data-pressed]]:underline",
        outline:
          "[--control-icon-color:var(--contrast-muted-foreground)] border-control-border bg-control text-foreground shadow-control active:shadow-none [:hover,[data-pressed]]:bg-control-hover",
        /** Rounded icon control on sidebar chrome, muted until hovered. */
        "sidebar-ghost":
          "[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-sidebar-muted-foreground hover:text-sidebar-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent",
        // A round floating outline control with muted ink, such as jump to latest.
        "outline-pill-muted":
          "[--control-icon-color:var(--contrast-muted-foreground)] rounded-full border-transparent bg-secondary text-muted-foreground shadow-xs hover:text-foreground [:active,[data-pressed]]:bg-accent [:hover,[data-pressed]]:bg-accent/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [:active,[data-pressed]]:bg-secondary/80 [:hover,[data-pressed]]:bg-secondary/90",
        // Muted icon action that fades out while aria-hidden.
        "ghost-fade":
          "[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-muted-foreground transition-opacity data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent aria-hidden:pointer-events-none aria-hidden:opacity-0",
      },
      presentation: buttonPresentations,
    },
  },
);

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  unstyled?: boolean;
  presentation?: VariantProps<typeof buttonVariants>["presentation"];
  size?: VariantProps<typeof buttonVariants>["size"];
}

function Button({
  className,
  variant,
  size,
  presentation,
  unstyled = false,
  render,
  ...props
}: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    className: unstyled
      ? cn(presentation && buttonPresentations[presentation], className)
      : cn(buttonVariants({ className, size, variant, presentation })),
    "data-slot": "button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export { Button, buttonVariants };
