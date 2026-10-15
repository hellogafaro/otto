import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import type * as React from "react";
import { DayPicker, type Chevron, type Root } from "react-day-picker";

import { cn } from "~/lib/utils";

import { buttonVariants } from "./button";

/**
 * Otto: shadcn's Calendar (base registry) on Otto's popup grid: 28px day cells like menu rows,
 * 6px corners, 13px figures, the 12px/500 muted label for weekdays, `icon-sm` ghost-muted
 * month arrows and the primary fill for the chosen day.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("w-fit [--cell-size:--spacing(7)]", className)}
      classNames={{
        months: "relative flex flex-col",
        month: "flex flex-col gap-1",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "ghost-muted", size: "icon-sm" }),
          "aria-disabled:opacity-64",
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost-muted", size: "icon-sm" }),
          "aria-disabled:opacity-64",
        ),
        month_caption: "flex h-(--cell-size) items-center justify-center px-(--cell-size)",
        caption_label: "font-medium text-base text-foreground sm:text-sm",
        month_grid: "border-collapse",
        weekdays: "flex",
        weekday:
          "flex size-(--cell-size) items-center justify-center font-medium text-muted-foreground text-xs",
        week: "flex",
        day: "group/day size-(--cell-size) p-0 text-center",
        day_button:
          "flex size-(--cell-size) cursor-pointer select-none items-center justify-center rounded-md text-base text-foreground tabular-nums outline-none hover:bg-secondary focus-visible:bg-secondary group-data-outside/day:text-muted-foreground group-data-today/day:font-semibold group-data-selected/day:bg-primary group-data-selected/day:text-primary-foreground sm:text-sm",
        disabled: "pointer-events-none opacity-64",
        hidden: "invisible",
        ...classNames,
      }}
      components={{ Root: CalendarRoot, Chevron: CalendarChevron, ...components }}
      {...props}
    />
  );
}

function CalendarRoot({ className, rootRef, ...props }: React.ComponentProps<typeof Root>) {
  return <div data-slot="calendar" ref={rootRef} className={className} {...props} />;
}

function CalendarChevron({ className, orientation }: React.ComponentProps<typeof Chevron>) {
  const Icon = orientation === "left" ? RiArrowLeftSLine : RiArrowRightSLine;

  return <Icon aria-hidden className={cn("size-4 rtl:rotate-180", className)} />;
}

export { Calendar };
