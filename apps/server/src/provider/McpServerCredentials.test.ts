import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { type McpServer, McpServerId } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { toMcpServerConfig } from "./Layers/agentController/McpConfiguration.ts";
import {
  mcpServerOAuthSecretName,
  readMcpServerHeaders,
  replaceMcpServerHeaders,
  withMcpServerCredentials,
} from "./McpServerCredentials.ts";

const serverId = McpServerId.make("linear");

const server: McpServer = {
  id: serverId,
  name: "Linear",
  transport: "url",
  url: "https://mcp.linear.app/mcp",
  enabled: true,
  visibility: "user",
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

const storeLayer = () =>
  ServerSecretStore.layer.pipe(
    Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "otto-mcp-credentials-" })),
  );

it.layer(NodeServices.layer)("McpServerCredentials", (it) => {
  it.effect("keeps a saved value when its name comes back without one, and drops the rest", () =>
    Effect.gen(function* () {
      yield* replaceMcpServerHeaders(serverId, [
        { name: "Authorization", value: "Bearer one" },
        { name: "X-Team", value: "core" },
      ]);

      const names = yield* replaceMcpServerHeaders(serverId, [
        { name: "Authorization", value: null },
        { name: "X-Region", value: "eu" },
      ]);

      assert.deepEqual(names, ["Authorization", "X-Region"]);
      assert.deepEqual(yield* readMcpServerHeaders(serverId), {
        Authorization: "Bearer one",
        "X-Region": "eu",
      });
    }).pipe(Effect.provide(storeLayer())),
  );

  it.effect("removes the secret when every header is gone", () =>
    Effect.gen(function* () {
      const store = yield* ServerSecretStore.ServerSecretStore;

      yield* replaceMcpServerHeaders(serverId, [{ name: "Authorization", value: "Bearer one" }]);
      yield* replaceMcpServerHeaders(serverId, []);

      assert.isTrue(Option.isNone(yield* store.get(`mcp-server-${serverId}-headers`)));
    }).pipe(Effect.provide(storeLayer())),
  );

  it.effect("gives a connection its headers and OAuth storage backed by the secrets table", () =>
    Effect.gen(function* () {
      const store = yield* ServerSecretStore.ServerSecretStore;

      yield* replaceMcpServerHeaders(serverId, [{ name: "Authorization", value: "Bearer one" }]);

      const connectable = yield* withMcpServerCredentials({ ...server });
      const config = toMcpServerConfig(connectable);

      assert.isTrue("url" in config);

      if (!("url" in config)) return;
      assert.deepEqual(config.headers, { Authorization: "Bearer one" });

      const storage = config.oauth?.storage;

      assert.isDefined(storage);
      yield* Effect.promise(async () => {
        await storage!.set("tokens", '{"access_token":"t"}');
      });

      assert.equal(
        yield* Effect.promise(async () => storage!.get("tokens")),
        '{"access_token":"t"}',
      );
      assert.isTrue(Option.isSome(yield* store.get(mcpServerOAuthSecretName(serverId))));

      yield* Effect.promise(async () => storage!.delete("tokens"));

      assert.isTrue(Option.isNone(yield* store.get(mcpServerOAuthSecretName(serverId))));
    }).pipe(Effect.provide(storeLayer())),
  );
});
