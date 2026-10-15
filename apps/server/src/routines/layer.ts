import * as Layer from "effect/Layer";

import { RoutineRepositoryLive } from "./repository-live.ts";
import { RoutineRuntimeLive } from "./runtime-live.ts";
import { RoutineRuntimeAdapterLive } from "./runtime-adapter-live.ts";

export const RoutineLayerLive = RoutineRuntimeLive.pipe(
  Layer.provide(Layer.mergeAll(RoutineRepositoryLive, RoutineRuntimeAdapterLive)),
);
