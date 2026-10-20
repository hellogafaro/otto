import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  expectedRemoteAssetNames,
  packageRemoteArchive,
  REMOTE_INSTALLERS,
  REMOTE_TARGETS,
  remoteArchiveName,
  remoteTargetFor,
  writeRemoteManifest,
} from "./package-remote.ts";

const scripts = import.meta.dirname;

// The installer verifies with the first OpenSSL 3 it finds; macOS ships LibreSSL as openssl.
const openssl3 = [
  "openssl",
  "/opt/homebrew/opt/openssl@3/bin/openssl",
  "/usr/local/opt/openssl@3/bin/openssl",
].find((candidate) =>
  /^OpenSSL [3-9]/.test(
    NodeChildProcess.spawnSync(candidate, ["version"], { encoding: "utf8" }).stdout ?? "",
  ),
);

const read = (name: string) => NodeFS.readFileSync(NodePath.join(scripts, name), "utf8");

const temporary = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-package-test-"));

describe("package-remote", () => {
  it("publishes exactly the archives the installers download", () => {
    const unix = read("install-remote.sh");
    const windows = read("install-remote.ps1");
    expect(unix).toContain('archive="Otto-Remote-$version-$platform-$arch.tar.gz"');
    expect(unix).toContain("linux-x64|darwin-arm64) ;;");
    expect(unix).toContain('"$base/OTTO-REMOTE-MANIFEST.txt"');
    expect(unix).toContain('"$base/OTTO-REMOTE-MANIFEST.sig"');
    expect(windows).toContain('$ArchiveName = "Otto-Remote-$Version-win32-$Architecture.zip"');
    expect(REMOTE_TARGETS.map((target) => `${target.platform}-${target.arch}`)).toEqual([
      "linux-x64",
      "darwin-arm64",
      "win32-x64",
    ]);
    expect(expectedRemoteAssetNames("1.2.3")).toEqual([
      "Otto-Remote-1.2.3-linux-x64.tar.gz",
      "Otto-Remote-1.2.3-darwin-arm64.tar.gz",
      "Otto-Remote-1.2.3-win32-x64.zip",
      "OTTO-REMOTE-MANIFEST.txt",
      "OTTO-REMOTE-MANIFEST.sig",
      "install-remote.sh",
      "install-remote.ps1",
    ]);
    expect(() => remoteTargetFor("linux", "arm64")).toThrow(/not published/);
  });

  it("packages a Unix archive whose launcher stays inside the Otto home", () => {
    const root = temporary();
    const runtime = NodePath.join(root, "runtime");
    const dist = NodePath.join(runtime, "node_modules", "otto", "dist");
    NodeFS.mkdirSync(dist, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dist, "bin.mjs"), "");
    NodeFS.writeFileSync(NodePath.join(dist, "service-launcher.mjs"), "");
    const fakeNode = NodePath.join(root, "fake-node");
    NodeFS.writeFileSync(fakeNode, '#!/bin/sh\nprintf \'%s|%s\\n\' "$OTTO_LEGACY_HOME" "$1"\n', {
      mode: 0o755,
    });
    const license = NodePath.join(root, "LICENSE");
    NodeFS.writeFileSync(license, "MIT\n");

    const archive = packageRemoteArchive({
      runtimeDirectory: runtime,
      outputDirectory: NodePath.join(root, "release"),
      version: "1.2.3",
      target: { platform: "linux", arch: "x64" },
      nodeBinary: fakeNode,
      license,
    });

    expect(NodePath.basename(archive)).toBe("Otto-Remote-1.2.3-linux-x64.tar.gz");

    // Extract the way install-remote.sh does.
    const installed = NodePath.join(root, "installed");
    NodeFS.mkdirSync(installed);
    NodeChildProcess.execFileSync("tar", [
      "-xzf",
      archive,
      "-C",
      installed,
      "--strip-components=1",
    ]);

    for (const file of [
      "otto",
      "node/bin/node",
      "remote-admin",
      "initialize-remote-identity.sh",
      "install-remote.sh",
      "VERSION",
      "node_modules/otto/dist/bin.mjs",
      "node_modules/otto/dist/service-launcher.mjs",
    ]) {
      expect(NodeFS.existsSync(NodePath.join(installed, file)), file).toBe(true);
    }

    expect(NodeFS.readFileSync(NodePath.join(installed, "VERSION"), "utf8")).toBe("1.2.3\n");

    // The installer links the launcher into the user's bin directory.
    const link = NodePath.join(root, "otto-link");
    NodeFS.symlinkSync(NodePath.join(installed, "otto"), link);
    const home = NodePath.join(root, "home");
    const env = { PATH: process.env.PATH, HOME: home, OTTO_LEGACY_HOME: "/legacy/.ottoLegacy" };
    const serve = NodeChildProcess.execFileSync(link, ["serve"], { env, encoding: "utf8" });
    expect(serve).toBe(
      `${NodePath.join(home, ".otto")}|${NodePath.join(installed, "node_modules/otto/dist/bin.mjs")}\n`,
    );

    const custom = NodeChildProcess.execFileSync(link, ["serve"], {
      env: { ...env, OTTO_HOME: "/srv/otto" },
      encoding: "utf8",
    });

    expect(custom.split("|")[0]).toBe("/srv/otto");

    const doctor = NodeChildProcess.spawnSync(link, ["remote", "doctor"], {
      env,
      encoding: "utf8",
    });

    expect(doctor.stdout).toContain(`${NodePath.join(home, ".otto")}|`);
  });

  it("signs a manifest the installer's openssl check accepts", () => {
    const directory = temporary();

    for (const target of REMOTE_TARGETS) {
      NodeFS.writeFileSync(
        NodePath.join(directory, remoteArchiveName("1.2.3", target)),
        target.arch,
      );
    }

    for (const installer of REMOTE_INSTALLERS) {
      NodeFS.copyFileSync(NodePath.join(scripts, installer), NodePath.join(directory, installer));
    }

    const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const tailscale = "a".repeat(64);

    // The release refuses a key that does not match the key pinned in the installer.
    expect(() =>
      writeRemoteManifest({
        directory,
        version: "1.2.3",
        privateKeyPem,
        externalChecksums: { "tailscale_1.88.4_amd64.tgz": tailscale },
      }),
    ).toThrow(/does not match/);

    const manifest = writeRemoteManifest({
      directory,
      version: "1.2.3",
      privateKeyPem,
      publicKeyPem,
      externalChecksums: { "tailscale_1.88.4_amd64.tgz": tailscale },
    });

    const lines = manifest.trimEnd().split("\n");
    expect(lines.map((line) => line.slice(66))).toEqual([
      "Otto-Remote-1.2.3-linux-x64.tar.gz",
      "Otto-Remote-1.2.3-darwin-arm64.tar.gz",
      "Otto-Remote-1.2.3-win32-x64.zip",
      "install-remote.sh",
      "install-remote.ps1",
      "tailscale_1.88.4_amd64.tgz",
    ]);
    expect(lines.at(-1)).toBe(`${tailscale}  tailscale_1.88.4_amd64.tgz`);

    const publicKeyPath = NodePath.join(directory, "manifest.pub");
    NodeFS.writeFileSync(publicKeyPath, publicKeyPem);

    expect(openssl3, "OpenSSL 3 is required to verify release manifests").toBeDefined();

    const verified = NodeChildProcess.spawnSync(openssl3 ?? "openssl", [
      "pkeyutl",
      "-verify",
      "-pubin",
      "-inkey",
      publicKeyPath,
      "-rawin",
      "-in",
      NodePath.join(directory, "OTTO-REMOTE-MANIFEST.txt"),
      "-sigfile",
      NodePath.join(directory, "OTTO-REMOTE-MANIFEST.sig"),
    ]);

    expect(verified.status).toBe(0);
  });
});
