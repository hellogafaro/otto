import * as Predicate from "effect/Predicate";
import { type ToolsInput } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { createTool, type NeedsApprovalFn } from "@mastra/core/tools";
import {
  OTTO_CREATE_ROUTINE_TOOL_NAME,
  OttoCreateRoutineInput,
  OttoUpdateRoutineInput,
} from "@otto/contracts";
import * as Schema from "effect/Schema";
import { z } from "zod";
import { createOttoMastraTools } from "../otto-mastra-tools.ts";
import { type OttoMastraToolOptions } from "./otto-harness-types.ts";
import { controllerModelId, controllerResourceId } from "./otto-memory.ts";
import type { resolveOttoMastraModel } from "./otto-models.ts";
import { ottoNativeWebSearch } from "./otto-web-search.ts";
import { deferredToolOptions, nativeToolSearch, toolSearchTool } from "./otto-tool-search.ts";
import { ottoActionNeedsApproval } from "./otto-actions.ts";
import {
  routineToolInputSchema,
  OTTO_DELETE_ROUTINES_TOOL_NAME,
  routineDeleteResultSchema,
  OTTO_UPDATE_ROUTINE_TOOL_NAME,
  routineUpdateInputSchema,
  routineUpdateResultSchema,
} from "./otto-routine-schemas.ts";

export const decodeCreateRoutineInput = Schema.decodeUnknownPromise(OttoCreateRoutineInput);

export const decodeUpdateRoutineInput = Schema.decodeUnknownPromise(OttoUpdateRoutineInput);

const confirmSchemas = {
  suspendSchema: z.object({
    question: z.string(),
    options: z.array(z.object({ label: z.string(), description: z.string() })),
    selectionMode: z.literal("single_select"),
  }),
  resumeSchema: z.string(),
};

/** Plain words for a routine schedule, for the question that confirms an edit. */
function describeSchedule(
  schedule: NonNullable<z.infer<typeof routineUpdateInputSchema>["schedule"]>,
) {
  switch (schedule.kind) {
    case "hourly":
      return schedule.everyHours === 1
        ? `every hour from ${schedule.time}`
        : `every ${schedule.everyHours} hours from ${schedule.time}`;
    case "daily":
      return `every day at ${schedule.time}`;
    case "weekdays":
      return `every weekday at ${schedule.time}`;
    case "weekly":
      return `every ${schedule.weekdays.join(", ")} at ${schedule.time}`;
  }
}

export async function resolveOttoTools(
  requestContext: RequestContext,
  options: OttoMastraToolOptions,
  resolveModel?: (requestContext: RequestContext) => ReturnType<typeof resolveOttoMastraModel>,
): Promise<ToolsInput> {
  const threadId = controllerResourceId(requestContext);

  if (!threadId) return {};

  const routineTool = options.createRoutine
    ? createTool({
        id: OTTO_CREATE_ROUTINE_TOOL_NAME,
        description:
          "Create a routine that runs instructions on a schedule in this chat. The person approves it in the app, so do not ask separately. Hourly runs every everyHours hours lined up with time; daily, weekdays and weekly run once at time. Returns the routine id.",
        inputSchema: routineToolInputSchema,
        requireApproval: false,
        execute: async ({ newChatEachRun, ...input }) =>
          options.createRoutine!(
            threadId,
            await decodeCreateRoutineInput(
              {
                ...input,
                ...(newChatEachRun ? { newChatEachRun } : {}),
              },
              {
                onExcessProperty: "error",
              },
            ),
          ),
      })
    : undefined;

  const deleteRoutinesTool =
    options.listRoutines && options.deleteRoutines
      ? createTool({
          id: OTTO_DELETE_ROUTINES_TOOL_NAME,
          description:
            "Delete routines for good; to stop one for now, use routine_update with paused. The person confirms in the app. Returns the deleted ids.",
          inputSchema: z.object({
            routineIds: z.array(z.string().trim().min(1)).min(1),
          }),
          outputSchema: routineDeleteResultSchema,
          suspendSchema: z.object({
            question: z.string(),
            options: z.array(
              z.object({
                label: z.string(),
                description: z.string(),
              }),
            ),
            selectionMode: z.literal("single_select"),
          }),
          resumeSchema: z.string(),
          strict: true,
          requireApproval: false,
          execute: async ({ routineIds }, context) => {
            const uniqueIds = [...new Set(routineIds)];
            const available = await options.listRoutines!(threadId);

            const requested = available.routines.filter((routine) =>
              uniqueIds.includes(routine.id),
            );

            if (requested.length !== uniqueIds.length) {
              return { status: "not-found" as const, deletedRoutineIds: [] };
            }

            const answer = context?.agent?.resumeData;

            if (answer === undefined) {
              const suspend = context?.agent?.suspend;

              if (!suspend) return { status: "cancelled" as const, deletedRoutineIds: [] };
              const names = requested.map((routine) => `"${routine.name}"`).join(", ");
              await suspend({
                question:
                  requested.length === 1
                    ? `Are you sure you want to delete ${names}?`
                    : `Are you sure you want to delete these routines: ${names}?`,
                options: [
                  {
                    label: "Delete routines",
                    description: "Stop these schedules and hide them from the routines list.",
                  },
                  { label: "Cancel", description: "Keep every routine." },
                ],
                selectionMode: "single_select",
              });

              return;
            }

            if (answer !== "Delete routines") {
              return { status: "cancelled" as const, deletedRoutineIds: [] };
            }

            return options.deleteRoutines!(threadId, uniqueIds);
          },
        })
      : undefined;

  const updateRoutineTool =
    options.listRoutines && options.updateRoutine
      ? createTool({
          id: OTTO_UPDATE_ROUTINE_TOOL_NAME,
          description:
            "Change a routine's name, instructions or schedule, or pause and resume it; null keeps a field. Find the id with search type routine. The person confirms changes in the app. Returns the routine status.",
          inputSchema: routineUpdateInputSchema,
          outputSchema: routineUpdateResultSchema,
          ...confirmSchemas,
          requireApproval: false,
          execute: async ({ routineId, name, instructions, schedule, paused }, context) => {
            const { routines } = await options.listRoutines!(threadId);
            const routine = routines.find((candidate) => candidate.id === routineId);

            if (!routine) return { status: "not-found" as const };

            const setPaused = async () => {
              if (paused === null || paused === undefined) return { status: "updated" as const };

              if (!options.setRoutinePaused) throw new Error("Pausing routines is not available.");
              const result = await options.setRoutinePaused(threadId, routineId, paused);

              return result.status === "not-found"
                ? { status: "not-found" as const }
                : { status: "updated" as const, enabled: !paused };
            };

            if (!name && !instructions && !schedule) return setPaused();

            const answer = context?.agent?.resumeData;

            if (answer === undefined) {
              const suspend = context?.agent?.suspend;

              if (!suspend) return { status: "cancelled" as const };

              const changes = [
                ...(name ? [`name to "${name}"`] : []),
                ...(schedule ? [`schedule to ${describeSchedule(schedule)}`] : []),
                ...(instructions ? [`instructions to: ${instructions}`] : []),
              ];

              await suspend({
                question: `Change "${routine.name}"? Set the ${changes.join("; ")}.`,
                options: [
                  { label: "Save changes", description: "Update the routine." },
                  { label: "Cancel", description: "Keep the routine as it is." },
                ],
                selectionMode: "single_select",
              });

              return;
            }

            if (answer !== "Save changes") return { status: "cancelled" as const };

            const updated = await options.updateRoutine!(
              threadId,
              routineId,
              await decodeUpdateRoutineInput(
                {
                  ...(name ? { name } : {}),
                  ...(instructions ? { instructions } : {}),
                  ...(schedule ? { schedule } : {}),
                },
                { onExcessProperty: "error" },
              ),
            );

            return updated.status === "updated" && paused !== null && paused !== undefined
              ? setPaused()
              : updated;
          },
        })
      : undefined;

  const search = nativeToolSearch(controllerModelId(requestContext));

  const ottoTools = createOttoMastraTools(
    threadId,
    options.toolRuntime,
    resolveModel &&
      ((abortSignal) =>
        ottoNativeWebSearch(
          controllerModelId(requestContext),
          () => resolveModel(requestContext),
          abortSignal,
        )),
    search,
  );

  return {
    ...approvalAwareTools(threadId, options.getThreadTools(threadId), options),
    ...ottoTools,
    ...(routineTool ? { [OTTO_CREATE_ROUTINE_TOOL_NAME]: routineTool } : {}),
    ...(deleteRoutinesTool ? { [OTTO_DELETE_ROUTINES_TOOL_NAME]: deleteRoutinesTool } : {}),
    ...(updateRoutineTool ? { [OTTO_UPDATE_ROUTINE_TOOL_NAME]: updateRoutineTool } : {}),
    ...(search && Object.keys(ottoTools).some((id) => deferredToolOptions(search, id))
      ? { tool_search: toolSearchTool(search) }
      : {}),
  };
}

export function approvalAwareTools(
  threadId: string,
  tools: ToolsInput,
  options: OttoMastraToolOptions,
): ToolsInput {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const existing =
        "needsApprovalFn" in tool
          ? (tool.needsApprovalFn ?? tool.requireApproval)
          : "requireApproval" in tool
            ? tool.requireApproval
            : undefined;

      const needsApproval: NeedsApprovalFn = async (input, context) => {
        const protectedAction = ottoActionNeedsApproval(name, input);

        await options.syncThreadToolApproval?.(threadId, name, protectedAction);

        return (
          protectedAction ||
          (Predicate.isFunction(existing) ? await existing(input, context) : existing === true)
        );
      };

      return [name, { ...tool, requireApproval: needsApproval, needsApprovalFn: needsApproval }];
    }),
  );
}

export {
  routineTime,
  OTTO_DELETE_ROUTINES_TOOL_NAME,
  OTTO_UPDATE_ROUTINE_TOOL_NAME,
  routineToolInputSchema,
  type OttoRoutineListResult,
  routineDeleteResultSchema,
  type OttoRoutineDeleteResult,
} from "./otto-routine-schemas.ts";
