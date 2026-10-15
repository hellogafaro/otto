import { RiCalendarLine } from "@remixicon/react";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { ComposerControl, ComposerControlIcon } from "../chat/composer-control";
import { Calendar } from "../ui/calendar";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SelectButton } from "../ui/select";

const dueDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

const dueDateWithYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "Oct 14" this year, "Jan 3, 2027" in any other. */
function formatDueDate(date: Date) {
  return date.getFullYear() === new Date().getFullYear()
    ? dueDateFormatter.format(date)
    : dueDateWithYearFormatter.format(date);
}

/**
 * Otto: A task's due day, picked from the calendar in a popover; picking the chosen day again
 * clears it. `ghost` is the quiet property row on a task page, `composer` a composer control.
 */
export function TaskDueDate({
  value,
  onChange,
  variant,
}: {
  readonly value: string | null;
  readonly onChange: (dueDate: string | null) => void;
  readonly variant: "ghost" | "composer";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [year, month, day] = (value ?? "").split("-").map(Number);
  const selected = year && month && day ? new Date(year, month - 1, day) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {variant === "composer" ? (
        <PopoverTrigger render={<ComposerControl aria-label={t("Due date")} />}>
          <ComposerControlIcon icon={RiCalendarLine} />
          {selected ? formatDueDate(selected) : t("Due date")}
        </PopoverTrigger>
      ) : (
        <PopoverTrigger
          render={
            <SelectButton
              size="sm"
              variant="ghost"
              className="w-auto min-w-0"
              aria-label={t("Due date")}
            />
          }
        >
          <span className="flex items-center gap-1.5">
            <RiCalendarLine aria-hidden className="size-3.5" />
            {selected ? formatDueDate(selected) : t("No due date")}
          </span>
        </PopoverTrigger>
      )}
      <PopoverPopup align="start">
        <Calendar
          mode="single"
          {...(selected ? { selected, defaultMonth: selected } : {})}
          onSelect={(next) => {
            onChange(
              next
                ? [
                    next.getFullYear(),
                    String(next.getMonth() + 1).padStart(2, "0"),
                    String(next.getDate()).padStart(2, "0"),
                  ].join("-")
                : null,
            );

            setOpen(false);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}
