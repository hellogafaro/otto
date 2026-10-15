import { EnvironmentOwnedDataCleanup } from "@otto/client-runtime/platform";
import { EnvironmentRpcRequestObserver } from "@otto/client-runtime/rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { clearComposerDraftsEnvironment } from "../composer-draft-store";
import { acknowledgeRpcRequest, trackRpcRequestSent } from "../rpc/request-latency-state";
import { connectionStorageLayer } from "./storage";
import { connectivityLayer, wakeupsLayer } from "./browser-signals";
import { capabilitiesLayer } from "./desktop-capabilities";
import { platformConnectionSourceLayer } from "./platform-registrations";

let nextObservedRpcRequestId = 0;

const environmentOwnedDataCleanupLayer = Layer.succeed(
  EnvironmentOwnedDataCleanup,
  EnvironmentOwnedDataCleanup.of({
    clear: (environmentId) =>
      Effect.sync(() => {
        clearComposerDraftsEnvironment(environmentId);
      }),
  }),
);

const rpcRequestObserverLayer = Layer.succeed(
  EnvironmentRpcRequestObserver,
  EnvironmentRpcRequestObserver.of({
    observe: ({ environmentId, method }) =>
      Effect.sync(() => {
        nextObservedRpcRequestId += 1;
        const requestId = `${environmentId}:${nextObservedRpcRequestId}`;
        trackRpcRequestSent(requestId, method, `${method} · ${environmentId}`);

        return Effect.sync(() => {
          acknowledgeRpcRequest(requestId);
        });
      }),
  }),
);

type ConnectionPlatformLayerSource =
  | typeof connectionStorageLayer
  | typeof connectivityLayer
  | typeof wakeupsLayer
  | typeof capabilitiesLayer
  | typeof platformConnectionSourceLayer
  | typeof environmentOwnedDataCleanupLayer
  | typeof rpcRequestObserverLayer;

export const connectionPlatformLayer: Layer.Layer<
  Layer.Success<ConnectionPlatformLayerSource>,
  Layer.Error<ConnectionPlatformLayerSource>,
  Layer.Services<ConnectionPlatformLayerSource>
> = Layer.mergeAll(
  connectionStorageLayer,
  connectivityLayer,
  wakeupsLayer,
  capabilitiesLayer,
  platformConnectionSourceLayer,
  environmentOwnedDataCleanupLayer,
  rpcRequestObserverLayer,
);

export { provisionDesktopSshEnvironment } from "./desktop-capabilities";

export {
  secondaryBearerExpiresAtEpochMs,
  secondaryBearerRefreshAtEpochMs,
  type PrimaryEnvironmentTargetRead,
  readPrimaryEnvironmentTargetResult,
  primaryRegistrationToRetainAfterTopologyRead,
  canReuseCachedPlatformRegistration,
  canRetainCachedPlatformRegistrationAfterRefreshFailure,
  secondaryRegistrationsToRetainAfterTopologyRead,
} from "./platform-registrations";
