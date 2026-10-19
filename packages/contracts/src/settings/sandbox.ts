import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { BotSandbox } from "../orchestration/roster.ts";
import { ProviderInstanceEnvironmentVariable } from "../provider-instance.ts";

export const SandboxProvider = BotSandbox;

/** Settings saved before only Local and Boat remained, or before Ascii Box became Boat. */
const RetiredSandboxProvider = Schema.Literals([
  "upstash",
  "tenki",
  "ascii",
  "e2b",
  "daytona",
  "vercel",
  "railway",
]);

const PersistedSandboxProvider = Schema.Union([SandboxProvider, RetiredSandboxProvider]).pipe(
  Schema.decodeTo(
    SandboxProvider,
    SchemaTransformation.transform({
      decode: (value) =>
        value === "ascii" ? "boat" : value === "local" || value === "boat" ? value : "local",
      encode: (value) => value,
    }),
  ),
);

export type SandboxProvider = BotSandbox;

export type CloudSandboxProvider = Exclude<SandboxProvider, "local">;

export const CLOUD_SANDBOX_PROVIDERS = ["boat"] as const;

export const SANDBOX_PROVIDER_CREDENTIALS = {
  boat: [{ name: "BOAT_API_KEY", sensitive: true }],
} as const satisfies Readonly<
  Record<
    CloudSandboxProvider,
    ReadonlyArray<{ readonly name: string; readonly sensitive: boolean }>
  >
>;

export const SandboxProviderConnection = Schema.Struct({
  environment: Schema.Array(ProviderInstanceEnvironmentVariable).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
}).pipe(Schema.withDecodingDefault(Effect.succeed({})));

export type SandboxProviderConnection = typeof SandboxProviderConnection.Type;

export const SandboxSettings = Schema.Struct({
  defaultProvider: PersistedSandboxProvider.pipe(
    Schema.withDecodingDefault(Effect.succeed("local" as const)),
  ),
  autoIdle: Schema.Literal(true).pipe(Schema.withDecodingDefault(Effect.succeed(true as const))),
  providers: Schema.Struct({
    boat: SandboxProviderConnection,
  }).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
}).pipe(Schema.withDecodingDefault(Effect.succeed({})));

export type SandboxSettings = typeof SandboxSettings.Type;

const SandboxProviderConnectionPatch = Schema.Struct({
  environment: Schema.optionalKey(Schema.Array(ProviderInstanceEnvironmentVariable)),
});

export const SandboxSettingsPatch = Schema.Struct({
  defaultProvider: Schema.optionalKey(SandboxProvider),
  autoIdle: Schema.optionalKey(Schema.Literal(true)),
  providers: Schema.optionalKey(
    Schema.Struct({
      boat: Schema.optionalKey(SandboxProviderConnectionPatch),
    }),
  ),
});
