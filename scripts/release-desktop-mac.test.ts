import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

const scriptPath = NodePath.resolve(import.meta.dirname, "./release-desktop-mac.sh");

function runRelease(env: Record<string, string>) {
  const result = NodeChildProcess.spawnSync("bash", [scriptPath], {
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
        "release-desktop-mac: set GH_TOKEN to a token that can write releases in hellogafaro/otto.\n",
    });
  });

  it("refuses to build without notarization credentials", () => {
    expect(runRelease({ GH_TOKEN: "placeholder" }).stderr).toContain(
      "or APPLE_KEYCHAIN_PROFILE, so the build can be notarized.",
    );
  });

  it("refuses a partial App Store Connect API key", () => {
    expect(runRelease({ GH_TOKEN: "placeholder", APPLE_API_KEY_ID: "ABC123" }).stderr).toContain(
      "set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER together.",
    );
  });
});
