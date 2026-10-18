import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

const scriptPath = NodePath.resolve(import.meta.dirname, "./release-desktop-mac.sh");

function runRelease(env: Record<string, string>, args: readonly string[] = []) {
  const result = NodeChildProcess.spawnSync("bash", [scriptPath, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
  });

  return { status: result.status, stderr: result.stderr };
}

describe("release-desktop-mac.sh", () => {
  it("refuses to start without a GitHub token", () => {
    expect(runRelease({})).toEqual({
      status: 1,
      stderr:
        "Release stopped. Set GH_TOKEN to a token that can write releases in hellogafaro/otto.\n",
    });
  });

  it("refuses to build without notarization credentials", () => {
    expect(runRelease({ GH_TOKEN: "placeholder" }).stderr).toContain(
      "or APPLE_KEYCHAIN_PROFILE, so the build can be notarized.",
    );
  });

  it("accepts only stable and beta release versions", () => {
    for (const version of ["1.2", "1.2.3-beta.1", "1.2.3-beta.12345.2.gabcdef123456"]) {
      expect(runRelease({ GH_TOKEN: "placeholder" }, ["--version", version])).toEqual({
        status: 1,
        stderr: `Release stopped. Version ${version} is neither stable (X.Y.Z) nor beta (X.Y.Z-beta.YYYYMMDD.N).\n`,
      });
    }

    expect(
      runRelease({ GH_TOKEN: "placeholder" }, ["--version", "1.2.4-beta.20261018.7"]).stderr,
    ).toContain("so the build can be notarized.");
    expect(runRelease({ GH_TOKEN: "placeholder" }, ["--version"]).stderr).toContain(
      "The --version option needs a value.",
    );
    expect(runRelease({ GH_TOKEN: "placeholder" }, ["--beta"]).stderr).toContain(
      "Unknown argument --beta.",
    );
  });

  it("refuses a partial App Store Connect API key", () => {
    expect(runRelease({ GH_TOKEN: "placeholder", APPLE_API_KEY_ID: "ABC123" }).stderr).toContain(
      "Set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER together.",
    );
  });
});
