import { type BotEngine, type ModelSelection, ProviderInstanceId } from "@otto/contracts";

/**
 * The model a group turn runs on: the responding member's own engine, else the
 * current app default. The model stored on the project is the one from setup.
 */
export function groupModelSelection(
  engine: BotEngine | null | undefined,
  projectDefault: ModelSelection | null | undefined,
  appDefault: ModelSelection | null,
): ModelSelection | null {
  return engine
    ? {
        instanceId: ProviderInstanceId.make(engine.provider),
        model: engine.model,
        ...(engine.options ? { options: engine.options } : {}),
      }
    : (appDefault ?? projectDefault ?? null);
}
