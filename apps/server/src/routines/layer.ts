import * as Layer from "effect/Layer";

import { RoutineRepositoryLive } from "./repository-live.ts";
import { RoutineTriggersLive } from "./routine-triggers.ts";
import { RoutineRuntimeLive } from "./runtime-live.ts";
import { RoutineRuntimeAdapterLive } from "./runtime-adapter-live.ts";

export const RoutineLayerLive = RoutineTriggersLive.pipe(
  Layer.provideMerge(RoutineRuntimeLive),
  Layer.provide(RoutineRuntimeAdapterLive.pipe(Layer.provideMerge(RoutineRepositoryLive))),
);
