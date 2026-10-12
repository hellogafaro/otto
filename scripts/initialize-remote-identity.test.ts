import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { expect, it } from "vite-plus/test";

const cases = [
  ["the Windows initializer", process.execPath, "initialize-remote-identity.cjs"],
  ["the Unix initializer", "sh", "initialize-remote-identity.sh"],
] as const;

for (const [label, runner, file] of cases) {
  it(`${label} ignores ambient OTTO_LEGACY_HOME and writes only to Otto home`, () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-identity-"));
    const legacy = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ottoLegacy-legacy-"));

    try {
      const result = NodeChildProcess.spawnSync(
        runner,
        [NodePath.join(import.meta.dirname, file)],
        {
          env: {
            PATH: process.env.PATH ?? "",
            HOME: root,
            OTTO_LEGACY_HOME: legacy,
            OTTO_IDENTITY_NODE: process.execPath,
          },
        },
      );

      expect(result.status).toBe(0);
      expect(
        NodeFS.existsSync(NodePath.join(root, ".otto", "userdata", "remote-link-identity.json")),
      ).toBe(true);
      expect(NodeFS.readdirSync(legacy)).toEqual([]);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
      NodeFS.rmSync(legacy, { recursive: true, force: true });
    }
  });
}
