import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { expect, it } from "vite-plus/test";

it("reads OTTO_HOME over an ambient OTTO_LEGACY_HOME and refuses an incompatible identity before publishing a version or switching the CLI", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-installer-refusal-"));
  const payload = NodePath.join(root, "payload", "Otto-Remote-1.2.3-linux-x64");
  const releases = NodePath.join(root, "release");
  const tools = NodePath.join(root, "tools");
  const installRoot = NodePath.join(root, "install");
  const binDir = NodePath.join(root, "bin");
  const home = NodePath.join(root, "home");
  const legacy = NodePath.join(root, "legacy-ottoLegacy");
  NodeFS.mkdirSync(NodePath.join(payload, "node", "bin"), { recursive: true });
  NodeFS.mkdirSync(releases);
  NodeFS.mkdirSync(tools);
  NodeFS.mkdirSync(NodePath.join(installRoot, "versions", "1.0.0"), { recursive: true });
  NodeFS.mkdirSync(binDir);
  NodeFS.mkdirSync(NodePath.join(home, "userdata"), { recursive: true });
  NodeFS.mkdirSync(legacy);
  NodeFS.writeFileSync(NodePath.join(payload, "otto"), "#!/bin/sh\n", { mode: 0o755 });
  NodeFS.symlinkSync(process.execPath, NodePath.join(payload, "node", "bin", "node"));
  NodeFS.copyFileSync(
    new URL("./initialize-remote-identity.sh", import.meta.url),
    NodePath.join(payload, "initialize-remote-identity.sh"),
  );
  NodeFS.chmodSync(NodePath.join(payload, "initialize-remote-identity.sh"), 0o755);
  const archive = NodePath.join(releases, "Otto-Remote-1.2.3-linux-x64.tar.gz");
  expect(
    NodeChildProcess.spawnSync("tar", [
      "-czf",
      archive,
      "-C",
      NodePath.dirname(payload),
      NodePath.basename(payload),
    ]).status,
  ).toBe(0);

  const hash = NodeChildProcess.spawnSync("sha256sum", [archive], {
    encoding: "utf8",
  }).stdout.split(" ")[0];

  NodeFS.writeFileSync(
    NodePath.join(releases, "OTTO-REMOTE-MANIFEST.txt"),
    `${hash}  ${NodePath.basename(archive)}\n`,
  );
  NodeFS.writeFileSync(NodePath.join(releases, "OTTO-REMOTE-MANIFEST.sig"), "test");
  NodeFS.writeFileSync(
    NodePath.join(tools, "curl"),
    `#!/bin/sh
destination=""
previous=""
for argument in "$@"; do
  [ "$previous" = -o ] && destination="$argument"
  previous="$argument"
done
for argument in "$@"; do source="$argument"; done
cp "$RELEASES/$(basename "$source")" "$destination"
`,
    { mode: 0o755 },
  );
  NodeFS.writeFileSync(NodePath.join(tools, "openssl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  NodeFS.writeFileSync(NodePath.join(installRoot, "versions", "1.0.0", "otto"), "old\n");
  NodeFS.symlinkSync(
    NodePath.join(installRoot, "versions", "1.0.0", "otto"),
    NodePath.join(binDir, "otto"),
  );
  NodeFS.writeFileSync(NodePath.join(home, "userdata", "environment-id"), "existing-env\n");
  const originalTarget = NodeFS.readlinkSync(NodePath.join(binDir, "otto"));

  const result = NodeChildProcess.spawnSync(
    "sh",
    [NodePath.join(import.meta.dirname, "install-remote.sh")],
    {
      env: {
        ...process.env,
        PATH: `${tools}:${process.env.PATH ?? ""}`,
        RELEASES: releases,
        OTTO_VERSION: "v1.2.3",
        OTTO_INSTALL_ROOT: installRoot,
        OTTO_BIN_DIR: binDir,
        OTTO_HOME: home,
        OTTO_LEGACY_HOME: legacy,
      },
      encoding: "utf8",
    },
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("--migrate-environment-id");
  expect(NodeFS.readlinkSync(NodePath.join(binDir, "otto"))).toBe(originalTarget);
  expect(NodeFS.readdirSync(NodePath.join(installRoot, "versions"))).toEqual(["1.0.0"]);
  // The refusal came from OTTO_HOME; the ambient Otto Legacy home was never touched.
  expect(NodeFS.readdirSync(legacy)).toEqual([]);
  NodeFS.rmSync(root, { recursive: true, force: true });
});
