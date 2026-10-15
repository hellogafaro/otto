/**
 * BUILT_IN_DRIVERS — the static set of `ProviderDriver`s this build ships
 * with.
 *
 * Every driver that the server knows how to instantiate from settings is
 * listed here. The `ProviderInstanceRegistry` iterates this array when
 * resolving `providerInstances` entries; anything not in the array surfaces
 * as an `"unavailable"` shadow snapshot at runtime (see
 * `buildUnavailableProviderSnapshot`).
 *
 * Adding a new first-party driver means:
 *   1. implement `ProviderDriver` in a sibling `Drivers/<Name>Driver.ts`,
 *   2. add it to this array,
 *   3. ensure the runtime layer satisfies its declared `R`.
 *
 * The aggregated `BuiltInDriversEnv` type is the union of every driver's
 * env requirement — the registry layer's `R` is this type, and the runtime
 * layer (ChildProcessSpawner, FileSystem, Path, ServerConfig,
 * OpenCodeRuntime, …) must satisfy it.
 *
 * @module provider/builtInDrivers
 */
import { ClaudeDriver, type ClaudeDriverEnv } from "./drivers/claude-driver.ts";
import { CodexDriver, type CodexDriverEnv } from "./drivers/codex-driver.ts";
import { CustomOpenaiDriver, type CustomOpenaiDriverEnv } from "./drivers/custom-openai-driver.ts";
import { GrokDriver, type GrokDriverEnv } from "./drivers/grok-driver.ts";
import { KimiDriver, type KimiDriverEnv } from "./drivers/kimi-driver.ts";
import { OpenCodeDriver, type OpenCodeDriverEnv } from "./drivers/open-code-driver.ts";
import { OpenCodeGoDriver, type OpenCodeGoDriverEnv } from "./drivers/open-code-go-driver.ts";
import { registeredProviderDriver } from "./registered-provider-driver.ts";
import type { AnyProviderDriver } from "./provider-driver.ts";

/**
 * Union of infrastructure services required to construct any built-in
 * driver. The registry layer declares `R = BuiltInDriversEnv`; the runtime
 * layer must provide every service in this union.
 */
export type BuiltInDriversEnv =
  | ClaudeDriverEnv
  | CodexDriverEnv
  | GrokDriverEnv
  | KimiDriverEnv
  | OpenCodeDriverEnv
  | OpenCodeGoDriverEnv
  | CustomOpenaiDriverEnv;

/**
 * Ordered list of built-in drivers. Order matters only for tie-breaking in
 * UI presentation — the registry itself is keyed by `driverKind`, so
 * iteration order has no functional effect on instance lookup.
 */
export const BUILT_IN_DRIVERS: ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>> = [
  registeredProviderDriver(CodexDriver),
  registeredProviderDriver(ClaudeDriver),
  registeredProviderDriver(GrokDriver),
  registeredProviderDriver(KimiDriver),
  registeredProviderDriver(OpenCodeDriver),
  registeredProviderDriver(OpenCodeGoDriver),
  registeredProviderDriver(CustomOpenaiDriver),
];
