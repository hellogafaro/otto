import * as Effect from "effect/Effect";
import { createWsServices } from "./ws-services.ts";
import { createWsOrchestrationStreams } from "./ws-orchestration-streams.ts";
import { createWsOrchestrationCommands } from "./ws-orchestration-commands.ts";

export const createWsConnection = (...args: Parameters<typeof createWsServices>) =>
  Effect.gen(function* () {
    const services = yield* createWsServices(...args);

    return {
      ...services,
      ...createWsOrchestrationStreams(services),
      ...createWsOrchestrationCommands(services),
    };
  });

export type WsConnection = Effect.Success<ReturnType<typeof createWsConnection>>;
