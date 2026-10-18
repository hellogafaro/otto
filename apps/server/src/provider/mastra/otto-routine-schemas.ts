import { OTTO_CREATE_ROUTINE_TOOL_NAME } from "@otto/contracts";
import type { OttoToolPrompt } from "../otto-agent-instructions.ts";
import { z } from "zod";

export const routineTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

const routineMonthDay = z.number().int().min(1).max(31);

export const OTTO_DELETE_ROUTINES_TOOL_NAME = "routine_delete";

export const OTTO_UPDATE_ROUTINE_TOOL_NAME = "routine_update";

/** What the routine tools add to the bot's prompt while they are loaded. */
export const OTTO_ROUTINE_TOOL_PROMPTS = new Map<string, OttoToolPrompt>([
  [OTTO_CREATE_ROUTINE_TOOL_NAME, { snippet: "schedule recurring work" }],
]);

export const routineToolInputSchema = z.object({
  name: z.string().trim().min(1),
  instructions: z.string().trim().min(1),
  schedule: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("hourly"),
      everyHours: z.literal([1, 2, 3, 4, 6, 8, 12]),
      time: routineTime,
    }),
    z.object({ kind: z.literal("daily"), time: routineTime }),
    z.object({ kind: z.literal("weekdays"), time: routineTime }),
    z.object({
      kind: z.literal("weekly"),
      weekdays: z
        .array(
          z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
        )
        .min(1),
      time: routineTime,
    }),
    z.object({ kind: z.literal("monthly"), day: routineMonthDay, time: routineTime }),
    z.object({ kind: z.literal("quarterly"), day: routineMonthDay, time: routineTime }),
    z.object({
      kind: z.literal("yearly"),
      month: z.number().int().min(1).max(12),
      day: routineMonthDay,
      time: routineTime,
    }),
  ]),
  threadMode: z.enum(["target", "per-run", "single"]).nullish(),
});

export const routineListOutputSchema = z.object({
  routines: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      enabled: z.boolean(),
      lifecycle: z.enum([
        "draft",
        "approved",
        "enabled",
        "running",
        "paused",
        "blocked",
        "failed",
        "completed",
      ]),
    }),
  ),
});

export type OttoRoutineListResult = z.infer<typeof routineListOutputSchema>;

export const routineDeleteResultSchema = z.object({
  status: z.enum(["deleted", "cancelled", "not-found"]),
  deletedRoutineIds: z.array(z.string()),
});

export type OttoRoutineDeleteResult = z.infer<typeof routineDeleteResultSchema>;

export const routineUpdateInputSchema = z.object({
  routineId: z.string().trim().min(1),
  name: routineToolInputSchema.shape.name.nullish(),
  instructions: routineToolInputSchema.shape.instructions.nullish(),
  schedule: routineToolInputSchema.shape.schedule.nullish(),
  paused: z.boolean().nullish(),
});

export const routineUpdateResultSchema = z.object({
  status: z.enum(["updated", "cancelled", "not-found"]),
  enabled: z.boolean().optional(),
});

export type OttoRoutineUpdateResult = z.infer<typeof routineUpdateResultSchema>;

export const routinePausedResultSchema = z.object({
  status: z.enum(["paused", "resumed", "not-found"]),
});

export type OttoRoutinePausedResult = z.infer<typeof routinePausedResultSchema>;
