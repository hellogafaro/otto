import { TASK_REPEATS, type TaskRepeat } from "@otto/contracts";
import { RiRepeatLine } from "@remixicon/react";

import { useI18n } from "../../i18n";
import type { PickerOpenState } from "../details-aside";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function useTaskRepeatLabel(): (repeat: TaskRepeat | null) => string {
  const { t } = useI18n();

  return (repeat) => {
    switch (repeat) {
      case null:
        return t("Does not repeat");
      case "daily":
        return t("Daily");
      case "weekdays":
        return t("Weekdays");
      case "weekly":
        return t("Weekly");
      case "monthly":
        return t("Monthly");
      case "quarterly":
        return t("Quarterly");
      case "yearly":
        return t("Yearly");
    }
  };
}

const NO_REPEAT = "none";

/**
 * Otto: How a task repeats, the quiet property row on a task page. Completing a repeating task
 * creates the next one with the next due date.
 */
export function TaskRepeatSelect({
  value,
  onChange,
  picker,
}: {
  readonly value: TaskRepeat | null;
  readonly onChange: (repeat: TaskRepeat | null) => void;
  readonly picker?: PickerOpenState;
}) {
  const { t } = useI18n();
  const label = useTaskRepeatLabel();

  return (
    <Select
      value={value ?? NO_REPEAT}
      onValueChange={(next) => onChange(TASK_REPEATS.find((repeat) => repeat === next) ?? null)}
      open={picker?.open}
      onOpenChange={picker?.onOpenChange}
    >
      <SelectTrigger size="sm" variant="ghost" className="w-auto min-w-0" aria-label={t("Repeat")}>
        <SelectValue>
          <span className="flex items-center gap-1.5">
            <RiRepeatLine aria-hidden className="size-3.5" />
            {label(value)}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false} finalFocus={picker?.finalFocus}>
        {[null, ...TASK_REPEATS].map((repeat) => (
          <SelectItem key={repeat ?? NO_REPEAT} hideIndicator value={repeat ?? NO_REPEAT}>
            {label(repeat)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
