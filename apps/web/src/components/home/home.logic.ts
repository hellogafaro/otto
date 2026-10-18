import type { Routine, TaskListItem } from "@otto/contracts";

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

const isOpen = (task: TaskListItem) =>
  task.status !== "completed" && task.status !== "cancelled" && task.status !== "archived";

const involves = (task: TaskListItem, personId: string) =>
  [task.owner, ...task.assignees].some(
    (participant) => participant?.kind === "person" && participant.personId === personId,
  );

/** A person's open tasks due today or earlier, the most overdue first. */
export function tasksDue(
  tasks: readonly TaskListItem[],
  personId: string,
  today: string,
): TaskListItem[] {
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

/** A person's own pattern: where their waves start and how they lean, from their id. */
export function ditherWaves(seed: number) {
  const pick = (salt: number, size: number) => (Math.floor(seed / salt) % size) / size;

  return {
    phase: pick(7, 97) * Math.PI * 2,
    tilt: 0.6 + pick(13, 89) * 0.8,
    scale: 2.2 + pick(17, 83) * 1.6,
  };
}

/** Otto: The dither's slow drifting waves at a point, from 0 to 1, shared by Home and covers. */
export function ditherWaveLevel(
  u: number,
  v: number,
  seconds: number,
  waves: ReturnType<typeof ditherWaves>,
) {
  const t = seconds * 0.12 + waves.phase;

  const wave =
    Math.sin(u * waves.scale + v * waves.tilt * 2 + t) * 0.5 +
    Math.sin(u * waves.scale * 0.6 - v * 3.1 - t * 0.8) * 0.3 +
    Math.cos((u - v) * waves.scale * 1.4 + t * 0.6) * 0.2;

  return 0.5 + wave * 0.5;
}

/**
 * How dense Home's dither is at a point, from 0 to 1: slow drifting waves, strongest at the top
 * and fading to nothing at the bottom and towards the sides, so it never reaches the cards.
 */
export function ditherDensity(
  u: number,
  v: number,
  seconds: number,
  waves: ReturnType<typeof ditherWaves>,
) {
  const fade = (1 - v) ** 1.6 * Math.min(1, u * 4, (1 - u) * 4);

  return Math.max(0, Math.min(1, ditherWaveLevel(u, v, seconds, waves) * fade * 0.85));
}
