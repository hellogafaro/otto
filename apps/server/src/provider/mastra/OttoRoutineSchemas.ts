import { z } from "zod";

export const routineTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const OTTO_LIST_ROUTINES_TOOL_NAME = "otto_list_routines";

export const OTTO_DELETE_ROUTINES_TOOL_NAME = "otto_delete_routines";

export const OTTO_UPDATE_ROUTINE_TOOL_NAME = "otto_update_routine";

export const OTTO_SET_ROUTINE_PAUSED_TOOL_NAME = "otto_set_routine_paused";

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
  ]),
  skillNames: z.array(z.string().trim().min(1)).nullish(),
  connectorNames: z.array(z.string().trim().min(1)).nullish(),
  newChatEachRun: z.boolean().nullish(),
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
