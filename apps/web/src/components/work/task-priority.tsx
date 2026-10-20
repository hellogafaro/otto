import { TASK_PRIORITIES, type TaskPriority } from "@otto/contracts";
import { RiFlagLine } from "@remixicon/react";

import { useI18n } from "../../i18n";
import { ComposerSelectControl } from "../chat/composer-control";
import type { PickerOpenState } from "../details-aside";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function useTaskPriorityLabel(): (priority: TaskPriority | null) => string {
  const { t } = useI18n();

  return (priority) => {
    switch (priority) {
      case null:
        return t("No priority");
      case "high":
        return t("High");
      case "medium":
        return t("Medium");
      case "low":
        return t("Low");
    }
  };
}

const NO_PRIORITY = "none";

/**
 * Otto: How urgent a task is, the quiet property row on a task page or a composer control in
 * New task: no priority, then high to low.
 */
export function TaskPrioritySelect({
  value,
  onChange,
  variant = "ghost",
  picker,
}: {
  readonly value: TaskPriority | null;
  readonly onChange: (priority: TaskPriority | null) => void;
  readonly variant?: "ghost" | "composer";
  readonly picker?: PickerOpenState;
}) {
  const { t } = useI18n();
  const label = useTaskPriorityLabel();
  const Trigger = variant === "composer" ? ComposerSelectControl : SelectTrigger;

  return (
    <Select
      value={value ?? NO_PRIORITY}
      onValueChange={(next) =>
        onChange(TASK_PRIORITIES.find((priority) => priority === next) ?? null)
      }
      open={picker?.open}
      onOpenChange={picker?.onOpenChange}
    >
      <Trigger
        size="sm"
        variant={variant === "ghost" ? "ghost" : undefined}
        className="w-auto min-w-0"
        aria-label={t("Priority")}
      >
        <SelectValue>
          <span className="flex items-center gap-1.5">
            <RiFlagLine aria-hidden className="size-3.5" />
            {variant === "composer" && value === null ? t("Priority") : label(value)}
          </span>
        </SelectValue>
      </Trigger>
      <SelectPopup alignItemWithTrigger={false} finalFocus={picker?.finalFocus}>
        {[null, ...TASK_PRIORITIES].map((priority) => (
          <SelectItem key={priority ?? NO_PRIORITY} hideIndicator value={priority ?? NO_PRIORITY}>
            {label(priority)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
