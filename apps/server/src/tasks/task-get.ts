import { type OrchestrationTask, type TaskGetInput, TaskNotFoundError } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ProjectionTaskRepository } from "../persistence/services/projection-tasks.ts";

/**
 * One task with its timesheet, archived or not. Every workspace member reads every task, as in the
 * task list, so the only refusal is a task that does not exist.
 */
export const getTask = (
  input: TaskGetInput,
  services: { readonly projectionTasks: ProjectionTaskRepository["Service"] },
): Effect.Effect<OrchestrationTask, TaskNotFoundError> =>
  services.projectionTasks.get(input.taskId).pipe(
    Effect.orDie,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new TaskNotFoundError({ taskId: input.taskId })),
        onSome: Effect.succeed,
      }),
    ),
  );
