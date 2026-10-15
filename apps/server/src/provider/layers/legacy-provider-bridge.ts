import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { LegacyProviderBridge } from "../services/legacy-provider-bridge.ts";
import { ProviderService } from "../services/provider-service.ts";

/** The only adapter that calls the existing ProviderService from AgentController. */
export const LegacyProviderBridgeLive = Layer.effect(
  LegacyProviderBridge,
  Effect.map(ProviderService, LegacyProviderBridge.of),
);
