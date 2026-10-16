import type { OrchestrationTask, Routine } from "@otto/contracts";

import { localDateKey } from "../../timestamp-format";

/** Otto: Greetings by time of day; Home picks one at random on each visit. */
const GREETINGS = {
  morning: [
    "Morning, {name}",
    "Good morning, {name}",
    "Rise and shine, {name}",
    "Coffee first, {name}?",
  ],
  afternoon: [
    "Afternoon, {name}",
    "Good to see you, {name}",
    "Back at it, {name}",
    "Keep it rolling, {name}",
  ],
  evening: [
    "Evening, {name}",
    "Good evening, {name}",
    "Winding down, {name}?",
    "One more thing, {name}?",
  ],
  night: [
    "Up late, {name}?",
    "Hello, night owl",
    "Burning the midnight oil, {name}?",
    "Quiet hours, {name}",
  ],
} as const;

export type Greeting = (typeof GREETINGS)[keyof typeof GREETINGS][number];

export function pickGreeting(hour: number, random: number): Greeting {
  const greetings =
    hour >= 5 && hour < 12
      ? GREETINGS.morning
      : hour >= 12 && hour < 18
        ? GREETINGS.afternoon
        : hour >= 18 && hour < 23
          ? GREETINGS.evening
          : GREETINGS.night;

  return greetings[Math.floor(random * greetings.length)] ?? greetings[0];
}

const isOpen = (task: OrchestrationTask) =>
  task.status !== "completed" && task.status !== "cancelled" && task.status !== "archived";

const involves = (task: OrchestrationTask, personId: string) =>
  [task.owner, ...task.assignees].some(
    (participant) => participant?.kind === "person" && participant.personId === personId,
  );

/** A person's open tasks due today or earlier, the most overdue first. */
export function tasksDue(
  tasks: readonly OrchestrationTask[],
  personId: string,
  today: string,
): OrchestrationTask[] {
  return tasks
    .filter(
      (task) =>
        task.dueDate !== null && task.dueDate <= today && isOpen(task) && involves(task, personId),
    )
    .toSorted((left, right) => (left.dueDate ?? "").localeCompare(right.dueDate ?? ""));
}

const day = (iso: string | null) => (iso === null ? null : localDateKey(new Date(iso)));

/** When a routine runs on `today`: its next run while that falls today, else its last run. */
export function routineTime(routine: Routine, today: string): string | null {
  return day(routine.nextRunAt) === today ? routine.nextRunAt : routine.lastRunAt;
}

/** Live routines that run, or already ran, on `today`, in time order. */
export function routinesToday(routines: readonly Routine[], today: string): Routine[] {
  return routines
    .filter(
      (routine) =>
        routine.enabled &&
        routine.lifecycle !== "deleted" &&
        (day(routine.nextRunAt) === today || day(routine.lastRunAt) === today),
    )
    .toSorted((left, right) =>
      (routineTime(left, today) ?? "").localeCompare(routineTime(right, today) ?? ""),
    );
}
