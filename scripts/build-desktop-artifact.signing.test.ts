import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { parse } from "yaml";

import {
  type MacSigningEnvironment,
  parseDeveloperIdIdentities,
  refreshUpdateManifestDmgEntry,
  resolveMacSigningPlan,
} from "./lib/desktop-build/mac-signing.ts";

const noCredentials: MacSigningEnvironment = {
  cscLink: undefined,
  cscName: undefined,
  autoDiscovery: true,
  apiKey: undefined,
  apiKeyId: undefined,
  apiIssuer: undefined,
  keychainProfile: undefined,
  keychain: undefined,
};

const apiKey: Partial<MacSigningEnvironment> = {
  apiKey: "/keys/AuthKey_ABC123.p8",
  apiKeyId: "ABC123",
  apiIssuer: "issuer-uuid",
};

const developerId = "Developer ID Application: Johan Gafaro (TEAM123456)";

const plan = (
  env: Partial<MacSigningEnvironment>,
  keychainIdentities: readonly string[] = [],
  requested?: boolean,
) =>
  resolveMacSigningPlan({
    requested,
    env: { ...noCredentials, ...env },
    keychainIdentities,
  });

const failure = (effect: ReturnType<typeof plan>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.message),
  );

it.layer(NodeServices.layer)("macOS signing plan", (it) => {
  it("reads only Developer ID Application identities from the keychain listing", () => {
    const output = [
      `  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Johan Gafaro (W38FLS57AB)"`,
      `  2) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "${developerId}"`,
      "     2 valid identities found",
    ].join("\n");

    assert.deepStrictEqual(parseDeveloperIdIdentities(output), [developerId]);
  });

  it.effect("builds ad-hoc when no identity or notarization credentials exist", () =>
    Effect.gen(function* () {
      const result = yield* plan({});

      assert.equal(result.kind, "ad-hoc");
    }),
  );

  it.effect("signs and notarizes with a keychain Developer ID and an API key", () =>
    Effect.gen(function* () {
      const result = yield* plan(apiKey, [developerId]);

      assert.deepStrictEqual(result, {
        kind: "identity",
        identity: developerId,
        source: "keychain",
        notarization: {
          kind: "api-key",
          keyPath: "/keys/AuthKey_ABC123.p8",
          keyId: "ABC123",
          issuer: "issuer-uuid",
        },
      });
    }),
  );

  it.effect("notarizes through a notarytool keychain profile", () =>
    Effect.gen(function* () {
      const result = yield* plan({ keychainProfile: "otto-notary" }, [developerId]);

      assert.deepInclude(result, {
        notarization: { kind: "keychain-profile", profile: "otto-notary", keychain: undefined },
      });
    }),
  );

  it.effect("signs without notarizing when only an explicit identity is set", () =>
    Effect.gen(function* () {
      const result = yield* plan({ cscName: "Apple Development: Johan Gafaro (W38FLS57AB)" });

      assert.deepStrictEqual(result, {
        kind: "identity",
        identity: "Apple Development: Johan Gafaro (W38FLS57AB)",
        source: "CSC_NAME",
        notarization: undefined,
      });
    }),
  );

  it.effect("keeps --signed=false ad-hoc even when credentials exist", () =>
    Effect.gen(function* () {
      const result = yield* plan(apiKey, [developerId], false);

      assert.equal(result.kind, "ad-hoc");
    }),
  );

  it.effect("rejects incomplete, ambiguous or identity-less signing configurations", () =>
    Effect.gen(function* () {
      assert.include(
        yield* failure(plan({ apiKey: "/keys/key.p8" }, [developerId])),
        "missing APPLE_API_KEY_ID, APPLE_API_ISSUER",
      );
      assert.include(
        yield* failure(plan({}, [developerId, `${developerId} 2`])),
        "choose one with CSC_NAME",
      );
      assert.include(yield* failure(plan({}, [], true)), "no Developer ID Application identity");
      assert.include(yield* failure(plan(apiKey)), "no Developer ID Application identity");
    }),
  );

  it.effect("refreshes the DMG entry in latest-mac.yml after stapling", () =>
    Effect.gen(function* () {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-dmg-manifest-"));
      const dmgPath = NodePath.join(directory, "Otto-Bot-1.2.3-arm64.dmg");
      const stapledBytes = Buffer.from("stapled disk image");
      NodeFS.writeFileSync(dmgPath, stapledBytes);
      NodeFS.writeFileSync(`${dmgPath}.blockmap`, "stale");
      NodeFS.writeFileSync(
        NodePath.join(directory, "latest-mac.yml"),
        [
          "version: 1.2.3",
          "files:",
          "  - url: Otto-Bot-1.2.3-arm64.zip",
          "    sha512: zip-hash",
          "    size: 10",
          "  - url: Otto-Bot-1.2.3-arm64.dmg",
          "    sha512: old-dmg-hash",
          "    size: 20",
          "path: Otto-Bot-1.2.3-arm64.zip",
          "sha512: zip-hash",
          "releaseDate: '2026-10-17T00:00:00.000Z'",
          "",
        ].join("\n"),
      );

      yield* refreshUpdateManifestDmgEntry(dmgPath);

      const manifest = parse(
        NodeFS.readFileSync(NodePath.join(directory, "latest-mac.yml"), "utf8"),
      );

      assert.deepStrictEqual(manifest.files, [
        { url: "Otto-Bot-1.2.3-arm64.zip", sha512: "zip-hash", size: 10 },
        {
          url: "Otto-Bot-1.2.3-arm64.dmg",
          sha512: NodeCrypto.createHash("sha512").update(stapledBytes).digest("base64"),
          size: stapledBytes.length,
        },
      ]);
      assert.equal(manifest.path, "Otto-Bot-1.2.3-arm64.zip");
      assert.isFalse(NodeFS.existsSync(`${dmgPath}.blockmap`));
    }),
  );
});
