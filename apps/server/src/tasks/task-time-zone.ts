import type { OrchestrationCommand } from "@otto/contracts";

/**
 * Otto: Task commands that count days (a repeat's next due day, a time entry's today) count
 * them in the organization's time zone, whoever sends them.
 */
export const withOrganizationTimeZone = <Command extends OrchestrationCommand>(
  command: Command,
  timeZone: string,
): Command =>
  command.type === "task.update" || command.type === "task.time.create"
    ? { ...command, timezone: timeZone }
    : command;
