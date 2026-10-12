import { assert, describe, it } from "@effect/vitest";
import { HostProcessPlatform } from "@otto/shared/hostProcess";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { buildRemoteOttoLegacyRunnerScript, REMOTE_PICK_PORT_SCRIPT } from "./tunnel.ts";
import { TEST_NODE_ENGINE_RANGE } from "./tunnel.test-support.ts";

describe("ssh tunnel scripts", () => {
  it.skipIf(HostProcessPlatform.defaultValue() === "win32")(
    "refuses an unconfigured registry fallback without invoking npm",
    () => {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-no-registry-"));

      try {
        NodeFS.symlinkSync(process.execPath, NodePath.join(directory, "node"));

        for (const executable of ["npm", "npx"]) {
          NodeFS.writeFileSync(
            NodePath.join(directory, executable),
            '#!/bin/sh\nprintf invoked > "$HOME/registry-called"\n',
            { mode: 0o700 },
          );
        }

        const result = NodeChildProcess.spawnSync(
          "/bin/sh",
          ["-c", buildRemoteOttoLegacyRunnerScript()],
          {
            env: { PATH: directory, HOME: directory },
            encoding: "utf8",
          },
        );

        assert.equal(result.status, 1);
        assert.include(result.stderr, "No npm package is configured");
        assert.isFalse(NodeFS.existsSync(NodePath.join(directory, "registry-called")));
      } finally {
        NodeFS.rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("builds the remote ottoLegacy runner with npx and npm fallbacks", () => {
    const script = buildRemoteOttoLegacyRunnerScript({
      nodeEngineRange: TEST_NODE_ENGINE_RANGE,
      packageSpec: "otto@latest",
    });

    assert.include(script, "OTTO_LEGACY_NODE_SCRIPT_PATH=''");
    assert.include(script, 'exec otto "$@"');
    assert.include(script, 'exec "$OTTO_LEGACY_CLI_PATH" "$@"');
    assert.include(script, "could not install 'otto@latest'");
    assert.include(script, "require_installed_otto_cli npx --yes --package 'otto@latest'");
    assert.include(script, "require_installed_otto_cli npm exec --yes --package 'otto@latest'");
    assert.include(script, "npm produced no otto executable");
    assert.include(script, 'prepend_path_if_dir "$HOME/.local/bin"');
    assert.include(script, `OTTO_LEGACY_NODE_ENGINE_RANGE='${TEST_NODE_ENGINE_RANGE}'`);
    assert.include(script, "remote_node_satisfies_engine()");
    assert.include(script, "function satisfiesSemverRange");
    assert.include(script, "satisfiesSemverRange(rawVersion, range)");
    assert.include(script, 'prepend_path_if_dir "$VOLTA_HOME/bin"');
    assert.include(script, 'prepend_path_if_dir "$HOME/.asdf/shims"');
    assert.include(script, 'prepend_path_if_dir "$HOME/.local/share/mise/shims"');
    assert.include(script, 'eval "$(fnm env --shell bash)"');
    assert.include(script, "fnm use --silent-if-unchanged");
    assert.include(script, "fnm use default");
    assert.include(script, 'prepend_path_if_dir "$HOME/.nodenv/shims"');
    assert.include(script, 'NVM_DIR="$HOME/.nvm"');
    assert.include(script, "nvm use --silent default");
    assert.include(script, 'for OTTO_LEGACY_NODE_BIN in "$NVM_DIR"/versions/node/*/bin');
    assert.notInclude(script, "ensure $NVM_DIR/nvm.sh is available");
  });

  it("does not hard-code a remote node engine range", () => {
    const script = buildRemoteOttoLegacyRunnerScript();

    assert.include(script, "OTTO_LEGACY_NODE_ENGINE_RANGE=''");
    assert.notInclude(script, TEST_NODE_ENGINE_RANGE);
  });

  it("shell-quotes package specs in the remote ottoLegacy runner", () => {
    const script = buildRemoteOttoLegacyRunnerScript({
      packageSpec: "ottoLegacy@nightly; touch /tmp/ottoLegacy-owned",
    });

    assert.include(
      script,
      "require_installed_otto_cli npx --yes --package 'ottoLegacy@nightly; touch /tmp/ottoLegacy-owned'",
    );
    assert.notInclude(script, "exec npx --yes ottoLegacy@nightly; touch /tmp/ottoLegacy-owned");
  });

  it("builds the remote ottoLegacy runner with a node script override", () => {
    const script = buildRemoteOttoLegacyRunnerScript({
      nodeScriptPath: "/Users/julius/Development/Work/codething-mvp/apps/server/dist/bin.mjs",
    });

    assert.include(
      script,
      "OTTO_LEGACY_NODE_SCRIPT_PATH='/Users/julius/Development/Work/codething-mvp/apps/server/dist/bin.mjs'",
    );
    assert.include(script, 'exec node "$OTTO_LEGACY_NODE_SCRIPT_PATH" "$@"');
  });

  it("allows the remote port picker to run without a state file path", () => {
    assert.include(REMOTE_PICK_PORT_SCRIPT, 'const filePath = process.argv[2] ?? "";');
  });
});
