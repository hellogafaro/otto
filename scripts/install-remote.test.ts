import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const script = NodeFS.readFileSync(new URL("./install-remote.sh", import.meta.url), "utf8");

describe("remote installer", () => {
  it("verifies signed archives and installs atomically", () => {
    expect(script).toContain("verify_checksum");
    expect(script).toContain('mv "$next" "$target"');
    expect(script).toContain('ln -sfn "$target/otto"');
    expect(script).toContain('runtime_home="${OTTO_HOME:-$HOME/.otto}"');
    // OTTO_LEGACY_HOME is only ever assigned from the Otto home, never read from the environment.
    expect(script.match(/OTTO_LEGACY_HOME[^\n]*/g)).toEqual([
      "OTTO_LEGACY_HOME, so it is",
      'OTTO_LEGACY_HOME="$runtime_home"',
      "OTTO_LEGACY_HOME",
    ]);
  });
  it("does not contact a hosted account directory", () => {
    expect(script).not.toContain("app.otto.bot/link");
    expect(script).not.toContain("remote link");
    expect(script).not.toContain("heartbeat");
  });
  it("checks only the installed Otto service for a healthy update", () => {
    expect(script).toContain("systemctl --user is-active otto.service");
    expect(script).not.toContain("systemctl --user is-active ottoLegacy.service");
  });
  it("only installs the platforms the release publishes", () => {
    expect(script).toContain("linux-x64|darwin-arm64) ;;");
  });
  it("resolves the latest release tag from the GitHub API response", () => {
    const program = /\| sed -n '([^']+)'/.exec(script)?.[1];
    expect(program).toBeDefined();

    const result = NodeChildProcess.spawnSync("sed", ["-n", program ?? ""], {
      input: '{\n  "url": "x",\n  "tag_name": "v1.2.3",\n  "name": "Otto v1.2.3"\n}\n',
      encoding: "utf8",
    });

    expect(result.stdout).toBe("v1.2.3\n");
  });
  it("quotes custom paths in the update unit", () => {
    expect(script).toContain('Environment=$(systemd_quote "OTTO_HOME=$runtime_home")');
    expect(script).toContain('ExecStart=$(systemd_quote "$bin_dir/otto") remote update');
    const quote = /^systemd_quote\(\) \{\n[\s\S]*?\n\}$/m.exec(script)?.[0];
    expect(quote).toBeDefined();

    const result = NodeChildProcess.spawnSync(
      "sh",
      ["-c", `${quote}\nsystemd_quote "$1"`, "sh", '/home/lee/My Bins/50%/a"b\\c/otto'],
      { encoding: "utf8" },
    );

    expect(result.stdout).toBe('"/home/lee/My Bins/50%%/a\\"b\\\\c/otto"');
  });
  it("is served unchanged as the public installer", () => {
    expect(
      NodeFS.readFileSync(new URL("../apps/web/public/install", import.meta.url), "utf8"),
    ).toBe(script);
  });
});
