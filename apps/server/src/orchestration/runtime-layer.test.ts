import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ChannelDeliveryStore from "../channels/channel-delivery-store.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import * as RepositoryIdentityResolver from "../project/repository-identity-resolver.ts";
import { OrchestrationLayerLive } from "./runtime-layer.ts";

it.effect("provides channel delivery storage to the server runtime", () =>
  Effect.gen(function* () {
    const store = yield* ChannelDeliveryStore.ChannelDeliveryStore;

    assert.isFunction(store.claim);
  }).pipe(
    Effect.provide(
      OrchestrationLayerLive.pipe(
        Layer.provideMerge(RepositoryIdentityResolver.layer),
        Layer.provideMerge(SqlitePersistenceMemory),
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "runtime-layer-test-" }),
        ),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);
