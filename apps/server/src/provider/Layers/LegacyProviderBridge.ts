import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { LegacyProviderBridge } from "../Services/LegacyProviderBridge.ts";
import { ProviderService } from "../Services/ProviderService.ts";

/** The only adapter that calls the existing ProviderService from AgentController. */
export const LegacyProviderBridgeLive = Layer.effect(
  LegacyProviderBridge,
  Effect.map(ProviderService, LegacyProviderBridge.of),
);
