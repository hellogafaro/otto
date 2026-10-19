import {
  DEFAULT_MODEL_BY_PROVIDER,
  isProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
} from "@otto/contracts";

/**
 * Enough of a provider snapshot to know whether a stored instance can still
 * run. Incomplete test snapshots omit `enabled` and are not treated as proof.
 */
export interface TurnProviderSnapshot {
  readonly instanceId: string;
  readonly enabled?: boolean;
  readonly installed?: boolean;
  readonly status?: string;
  readonly availability?: string;
  readonly driver?: string;
  readonly models?: ReadonlyArray<{
    readonly slug: string;
    readonly isDefault?: boolean;
    readonly isLegacy?: boolean;
  }>;
}

export interface TurnModelSelectionInput {
  /** A saved bot engine is a choice. It is returned even when it cannot run. */
  readonly botEngine?: {
    readonly provider: string;
    readonly model: string;
    readonly options?: ModelSelection["options"];
  } | null;
  readonly requested?: ModelSelection | null;
  readonly stored?: ModelSelection | null;
  readonly liveDefault: ModelSelection;
  readonly isBotThread: boolean;
  readonly providers?: ReadonlyArray<TurnProviderSnapshot>;
}

function sameSelection(
  left: ModelSelection | null | undefined,
  right: ModelSelection | null | undefined,
): boolean {
  return (
    left != null &&
    right != null &&
    left.instanceId === right.instanceId &&
    left.model === right.model
  );
}

function listIsAuthoritative(providers: ReadonlyArray<TurnProviderSnapshot> | undefined): boolean {
  return Boolean(
    providers?.some((entry) => entry.enabled !== undefined || entry.status !== undefined),
  );
}

/** True when the instance can run, false when it is off or gone, undefined when unknown. */
function canRun(
  providers: ReadonlyArray<TurnProviderSnapshot> | undefined,
  instanceId: string,
): boolean | undefined {
  if (!listIsAuthoritative(providers)) return undefined;

  const provider = providers?.find((entry) => entry.instanceId === instanceId);

  if (!provider) return false;

  if (
    provider.enabled === false ||
    provider.status === "disabled" ||
    provider.availability === "unavailable" ||
    provider.installed === false
  ) {
    return false;
  }

  if (provider.enabled === true) return true;

  return undefined;
}

function modelFor(provider: TurnProviderSnapshot): string | undefined {
  const advertised =
    provider.models?.find((entry) => entry.isDefault && !entry.isLegacy) ??
    provider.models?.find((entry) => !entry.isLegacy) ??
    provider.models?.[0];

  if (advertised) return advertised.slug;

  if (provider.driver && isProviderDriverKind(provider.driver)) {
    return DEFAULT_MODEL_BY_PROVIDER[provider.driver];
  }

  return undefined;
}

function runnableFallback(
  providers: ReadonlyArray<TurnProviderSnapshot> | undefined,
  liveDefault: ModelSelection,
  avoidInstanceId: string,
): ModelSelection | undefined {
  if (
    liveDefault.instanceId !== avoidInstanceId &&
    canRun(providers, String(liveDefault.instanceId)) === true
  ) {
    return liveDefault;
  }

  for (const provider of providers ?? []) {
    if (provider.instanceId === avoidInstanceId) continue;

    if (canRun(providers, provider.instanceId) !== true) continue;

    const model = modelFor(provider);

    if (!model) continue;

    return {
      instanceId: ProviderInstanceId.make(provider.instanceId),
      model,
    };
  }

  return undefined;
}

/**
 * The instance a turn will run. A chat can still store a provider that was
 * turned off or removed after a swap. That leftover is not inspected. A saved
 * bot engine, or an explicit choice of a different provider, is returned as
 * chosen so a failure names that provider.
 */
export function resolveTurnModelSelection(input: TurnModelSelectionInput): ModelSelection {
  if (input.botEngine) {
    return {
      instanceId: ProviderInstanceId.make(input.botEngine.provider),
      model: input.botEngine.model,
      ...(input.botEngine.options ? { options: input.botEngine.options } : {}),
    };
  }

  const requested = input.requested ?? undefined;
  const stored = input.stored ?? undefined;

  const repeatsStored = sameSelection(requested, stored);

  // A bot chat copies the project model onto every send. Repeating it is not
  // a choice, and neither is omitting a selection on a server wake.
  const explicit =
    input.isBotThread && (requested === undefined || repeatsStored) ? undefined : requested;

  const candidate =
    explicit ?? (input.isBotThread ? input.liveDefault : (stored ?? input.liveDefault));

  if (explicit && stored && explicit.instanceId !== stored.instanceId) {
    return candidate;
  }

  if (canRun(input.providers, String(candidate.instanceId)) !== false) {
    return candidate;
  }

  return (
    runnableFallback(input.providers, input.liveDefault, String(candidate.instanceId)) ?? candidate
  );
}
