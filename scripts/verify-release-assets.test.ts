import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, it } from "vite-plus/test";

import { expectedReleaseAssetNames, verifyReleaseAssets } from "./verify-release-assets.ts";
import { verifyReleaseCandidate } from "./verify-release-candidate.ts";

describe("verify-release-assets", () => {
  it("matches the native desktop and Otto Remote artifact names", () => {
    NodeAssert.deepEqual(expectedReleaseAssetNames("1.2.3"), [
      "Otto-Bot-1.2.3-arm64.dmg",
      "Otto-Bot-1.2.3-arm64.dmg.blockmap",
      "Otto-Bot-1.2.3-arm64.zip",
      "Otto-Bot-1.2.3-arm64.zip.blockmap",
      "Otto-Bot-1.2.3-x64.exe",
      "Otto-Bot-1.2.3-x64.exe.blockmap",
      "Otto-Bot-1.2.3-x64.AppImage",
      "latest-mac.yml",
      "latest.yml",
      "latest-linux.yml",
      "Otto-Remote-1.2.3-linux-x64.tar.gz",
      "Otto-Remote-1.2.3-darwin-arm64.tar.gz",
      "Otto-Remote-1.2.3-win32-x64.zip",
      "OTTO-REMOTE-MANIFEST.txt",
      "OTTO-REMOTE-MANIFEST.sig",
      "install-remote.sh",
      "install-remote.ps1",
    ]);
  });

  it("rejects missing assets and writes verified SHA256SUMS for the exact release set", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "otto-release-assets-"));

    const names = expectedReleaseAssetNames("1.2.3");

    for (const name of names) await NodeFSP.writeFile(NodePath.join(directory, name), name);

    const sums = await verifyReleaseAssets(directory, "1.2.3");
    NodeAssert.equal(sums, await NodeFSP.readFile(NodePath.join(directory, "SHA256SUMS"), "utf8"));
    NodeAssert.equal(sums.trimEnd().split("\n").length, names.length);
    NodeAssert.doesNotThrow(() => verifyReleaseCandidate(directory, "1.2.3"));

    await NodeFSP.writeFile(NodePath.join(directory, "unexpected.txt"), "unexpected");
    await NodeAssert.rejects(verifyReleaseAssets(directory, "1.2.3"), /Release assets differ/);
  });
});
