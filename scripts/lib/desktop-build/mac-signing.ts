import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeStreamPromises from "node:stream/promises";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { ChildProcess } from "effect/unstable/process";
import { isMap, isSeq, parseDocument } from "yaml";

import { MacDmgNotarizationError, MacSigningConfigurationError } from "./errors.ts";
import { runCommand, spawnAndCollectOutput } from "./process.ts";

const DEVELOPER_ID_PREFIX = "Developer ID Application: ";

export type MacNotarization =
  | {
      readonly kind: "api-key";
      readonly keyPath: string;
      readonly keyId: string;
      readonly issuer: string;
    }
  | {
      readonly kind: "keychain-profile";
      readonly profile: string;
      readonly keychain: string | undefined;
    };

export type MacSigningPlan =
  | { readonly kind: "ad-hoc"; readonly reason: string }
  | {
      readonly kind: "identity";
      readonly identity: string;
      readonly source: "CSC_LINK" | "CSC_NAME" | "keychain";
      readonly notarization: MacNotarization | undefined;
    };

export interface MacSigningEnvironment {
  readonly cscLink: string | undefined;
  readonly cscName: string | undefined;
  readonly autoDiscovery: boolean;
  readonly apiKey: string | undefined;
  readonly apiKeyId: string | undefined;
  readonly apiIssuer: string | undefined;
  readonly keychainProfile: string | undefined;
  readonly keychain: string | undefined;
}

const optionalString = (name: string) =>
  Config.string(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)?.trim() || undefined),
  );

export const MacSigningEnvironmentConfig = Config.all({
  cscLink: optionalString("CSC_LINK"),
  cscName: optionalString("CSC_NAME"),
  autoDiscovery: optionalString("CSC_IDENTITY_AUTO_DISCOVERY").pipe(
    Config.map((value) => value !== "false"),
  ),
  apiKey: optionalString("APPLE_API_KEY"),
  apiKeyId: optionalString("APPLE_API_KEY_ID"),
  apiIssuer: optionalString("APPLE_API_ISSUER"),
  keychainProfile: optionalString("APPLE_KEYCHAIN_PROFILE"),
  keychain: optionalString("APPLE_KEYCHAIN"),
});

export function parseDeveloperIdIdentities(findIdentityOutput: string): readonly string[] {
  return [...findIdentityOutput.matchAll(/"([^"]+)"/g)].flatMap(([, name]) =>
    name?.startsWith(DEVELOPER_ID_PREFIX) ? [name] : [],
  );
}

const resolveNotarization = Effect.fn("resolveNotarization")(function* (
  env: MacSigningEnvironment,
) {
  const apiKeyValues = {
    APPLE_API_KEY: env.apiKey,
    APPLE_API_KEY_ID: env.apiKeyId,
    APPLE_API_ISSUER: env.apiIssuer,
  };

  const missing = Object.entries(apiKeyValues)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);

  if (missing.length > 0 && missing.length < 3) {
    return yield* new MacSigningConfigurationError({
      problem: `set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER together; missing ${missing.join(", ")}.`,
    });
  }

  if (env.apiKey && env.apiKeyId && env.apiIssuer) {
    return {
      kind: "api-key",
      keyPath: env.apiKey,
      keyId: env.apiKeyId,
      issuer: env.apiIssuer,
    } satisfies MacNotarization;
  }

  if (env.keychainProfile) {
    return {
      kind: "keychain-profile",
      profile: env.keychainProfile,
      keychain: env.keychain,
    } satisfies MacNotarization;
  }

  return undefined;
});

export const resolveMacSigningPlan = Effect.fn("resolveMacSigningPlan")(function* (input: {
  readonly requested: boolean | undefined;
  readonly env: MacSigningEnvironment;
  readonly keychainIdentities: readonly string[];
}) {
  if (input.requested === false) {
    return { kind: "ad-hoc", reason: "signing was turned off with --signed=false" } as const;
  }

  const notarization = yield* resolveNotarization(input.env);

  if (input.env.cscLink) {
    return {
      kind: "identity",
      identity: input.env.cscName ?? "the certificate in CSC_LINK",
      source: "CSC_LINK",
      notarization,
    } as const;
  }

  if (input.env.cscName) {
    return {
      kind: "identity",
      identity: input.env.cscName,
      source: "CSC_NAME",
      notarization,
    } as const;
  }

  if (input.keychainIdentities.length > 1) {
    return yield* new MacSigningConfigurationError({
      problem: `the keychain has several Developer ID Application identities (${input.keychainIdentities.join(", ")}); choose one with CSC_NAME.`,
    });
  }

  const keychainIdentity = input.keychainIdentities[0];

  if (keychainIdentity) {
    return {
      kind: "identity",
      identity: keychainIdentity,
      source: "keychain",
      notarization,
    } as const;
  }

  if (input.requested || notarization) {
    return yield* new MacSigningConfigurationError({
      problem:
        "no Developer ID Application identity was found in the keychain, CSC_NAME or CSC_LINK.",
    });
  }

  return {
    kind: "ad-hoc",
    reason: "no Developer ID Application certificate is in the keychain or CSC_LINK",
  } as const;
});

export const findKeychainDeveloperIdIdentities = Effect.gen(function* () {
  const result = yield* spawnAndCollectOutput(
    ChildProcess.make("security", ["find-identity", "-v", "-p", "codesigning"]),
  ).pipe(Effect.orElseSucceed(() => ({ stdout: "", stderr: "", exitCode: 1 })));

  return result.exitCode === 0 ? parseDeveloperIdIdentities(result.stdout) : [];
});

export const loadMacSigningPlan = Effect.fn("loadMacSigningPlan")(function* (
  requested: boolean | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const env = yield* MacSigningEnvironmentConfig;

  const keychainIdentities =
    requested !== false && !env.cscLink && !env.cscName && env.autoDiscovery
      ? yield* findKeychainDeveloperIdIdentities
      : [];

  const plan = yield* resolveMacSigningPlan({ requested, env, keychainIdentities });

  if (
    plan.kind === "identity" &&
    plan.notarization?.kind === "api-key" &&
    !(yield* fs.exists(plan.notarization.keyPath).pipe(Effect.orElseSucceed(() => false)))
  ) {
    return yield* new MacSigningConfigurationError({
      problem: `APPLE_API_KEY must be the path of the App Store Connect .p8 key file, and ${plan.notarization.keyPath} does not exist.`,
    });
  }

  return plan;
});

export function describeMacSigningPlan(plan: MacSigningPlan): string {
  if (plan.kind === "ad-hoc") {
    return `UNSIGNED BUILD: ad-hoc signature only, because ${plan.reason}. It has no update feed, so it will never update itself, and Gatekeeper blocks it on other Macs. See deploy/desktop-mac/README.md to sign.`;
  }

  if (!plan.notarization) {
    return `Signed with ${plan.identity} (${plan.source}) but NOT notarized, because no APPLE_API_KEY or APPLE_KEYCHAIN_PROFILE is set. Gatekeeper rejects it on other Macs, so use it only for local update testing.`;
  }

  const notarizedWith =
    plan.notarization.kind === "api-key"
      ? `App Store Connect API key ${plan.notarization.keyId}`
      : `notarytool keychain profile ${plan.notarization.profile}`;

  return `Signing with ${plan.identity} (${plan.source}), hardened runtime, notarizing and stapling with ${notarizedWith}.`;
}

function notarytoolCredentialArgs(notarization: MacNotarization): readonly string[] {
  if (notarization.kind === "api-key") {
    return [
      "--key",
      notarization.keyPath,
      "--key-id",
      notarization.keyId,
      "--issuer",
      notarization.issuer,
    ];
  }

  return [
    "--keychain-profile",
    notarization.profile,
    ...(notarization.keychain ? ["--keychain", notarization.keychain] : []),
  ];
}

const sha512Base64 = (filePath: string) =>
  Effect.tryPromise(async () => {
    const hash = NodeCrypto.createHash("sha512");
    await NodeStreamPromises.pipeline(NodeFS.createReadStream(filePath), hash);

    return hash.digest("base64");
  });

export const refreshUpdateManifestDmgEntry = Effect.fn("refreshUpdateManifestDmgEntry")(function* (
  dmgPath: string,
  updateChannel: "latest" | "beta",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const manifestPath = path.join(path.dirname(dmgPath), `${updateChannel}-mac.yml`);
  const dmgName = path.basename(dmgPath);

  yield* Effect.gen(function* () {
    const sha512 = yield* sha512Base64(dmgPath);
    const { size } = yield* fs.stat(dmgPath);
    const manifest = parseDocument(yield* fs.readFileString(manifestPath));
    const files = manifest.get("files", true);

    if (!isSeq(files)) {
      return yield* Effect.fail(`${manifestPath} has no files list.`);
    }

    for (const item of files.items) {
      if (isMap(item) && item.get("url") === dmgName) {
        item.set("sha512", sha512);
        item.set("size", Number(size));
      }
    }

    yield* fs.writeFileString(manifestPath, manifest.toString());
    yield* fs.remove(`${dmgPath}.blockmap`, { force: true });
  }).pipe(Effect.mapError((cause) => new MacDmgNotarizationError({ dmgPath, cause })));
});

export const notarizeAndStapleDmg = Effect.fn("notarizeAndStapleDmg")(function* (input: {
  readonly dmgPath: string;
  readonly updateChannel: "latest" | "beta";
  readonly notarization: MacNotarization;
  readonly verbose: boolean;
}) {
  const path = yield* Path.Path;
  const { dmgPath, updateChannel, notarization, verbose } = input;

  yield* runCommand(
    ChildProcess.make("xcrun", [
      "notarytool",
      "submit",
      dmgPath,
      ...notarytoolCredentialArgs(notarization),
      "--wait",
    ]),
    { label: `xcrun notarytool submit ${path.basename(dmgPath)} --wait`, verbose },
  );
  yield* runCommand(ChildProcess.make("xcrun", ["stapler", "staple", dmgPath]), {
    label: `xcrun stapler staple ${path.basename(dmgPath)}`,
    verbose,
  });
  yield* refreshUpdateManifestDmgEntry(dmgPath, updateChannel);
});
