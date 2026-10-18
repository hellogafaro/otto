import { type RoutineGetInput, type RoutineListQuery, WS_METHODS } from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  type AssignRoutineSkillInput,
  type UnassignRoutineSkillInput,
  approveRoutine,
  assignRoutineSkill,
  deleteRoutine,
  draftRoutine,
  enableRoutine,
  pauseRoutine,
  runRoutine,
  unassignRoutineSkill,
  updateRoutine,
} from "../operations/commands.ts";
import { request } from "../rpc/client.ts";
import { routineCacheAtom, withRoutines } from "./routine-cache.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
} from "./runtime.ts";

export {
  routineCacheAtom,
  routineChangesAtom,
  withRoutines,
  type RoutineCache,
} from "./routine-cache.ts";

export type {
  ApproveRoutineInput,
  AssignRoutineSkillInput,
  DeleteRoutineInput,
  DraftRoutineInput,
  EnableRoutineInput,
  PauseRoutineInput,
  RunRoutineInput,
  UnassignRoutineSkillInput,
  UpdateRoutineInput,
} from "../operations/commands.ts";

export function createRoutineEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  const scheduler = createAtomCommandScheduler();

  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { routineId: string } }) =>
      JSON.stringify([environmentId, "routine", input.routineId]),
  };

  const command = <Input extends { routineId: string }>(
    label: string,
    execute: (input: Input) => ReturnType<typeof draftRoutine>,
  ) => createEnvironmentCommand(runtime, { label, execute, scheduler, concurrency });

  return {
    /** One routine the viewer may see, or null; it lands in the routine cache. */
    get: createEnvironmentCommand(runtime, {
      label: "environment-data:routines:get",
      execute: (input: RoutineGetInput, registry, environmentId) =>
        request(WS_METHODS.routinesGet, input).pipe(
          Effect.tap((routine) =>
            Effect.sync(() => {
              if (routine !== null) {
                registry.update(routineCacheAtom(environmentId), (cache) =>
                  withRoutines(cache, [routine]),
                );
              }
            }),
          ),
        ),
    }),
    /** One page of the bounded routine list; its routines land in the routine cache. */
    list: createEnvironmentCommand(runtime, {
      label: "environment-data:routines:list",
      execute: (input: RoutineListQuery, registry, environmentId) =>
        request(WS_METHODS.routinesList, input).pipe(
          Effect.tap((page) =>
            Effect.sync(() =>
              registry.update(routineCacheAtom(environmentId), (cache) =>
                withRoutines(cache, page.routines),
              ),
            ),
          ),
        ),
    }),
    /** One routine's runs, newest first; a bot's routine list asks for each routine's. */
    listRuns: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:routines:list-runs",
      tag: WS_METHODS.routinesListRuns,
    }),
    draft: command("environment-data:commands:routine:draft", draftRoutine),
    approve: command("environment-data:commands:routine:approve", approveRoutine),
    enable: command("environment-data:commands:routine:enable", enableRoutine),
    pause: command("environment-data:commands:routine:pause", pauseRoutine),
    run: command("environment-data:commands:routine:run", runRoutine),
    update: command("environment-data:commands:routine:update", updateRoutine),
    delete: command("environment-data:commands:routine:delete", deleteRoutine),
    assignSkill: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:routine:skill:assign",
      execute: (input: AssignRoutineSkillInput) => assignRoutineSkill(input),
      scheduler,
    }),
    unassignSkill: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:routine:skill:unassign",
      execute: (input: UnassignRoutineSkillInput) => unassignRoutineSkill(input),
      scheduler,
    }),
  };
}
