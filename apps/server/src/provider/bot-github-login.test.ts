import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { GitHubTurnLogin } from "../github/github-accounts.ts";
import { createBotGitHubLogins } from "./bot-github-login.ts";
import { withCommandEnvironment } from "./tools/otto-workspace-tools.ts";
import { wrap } from "./workspace/bot-workspace-lifecycle.ts";

const TOKEN = "ghu_secretToken123";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});

const TOOLS = ["sh", "mkdir", "chmod", "rm", "mv", "mktemp", "uname", "tar", "gzip", "cp", "git"];

/**
 * A computer without gh whose curl serves a gh release archive from disk and logs each URL, so
 * the install runs for real without the network.
 */
async function computerTools(root: string) {
  const tools = NodePath.join(root, "..", `${NodePath.basename(root)}-tools`);
  const release = NodePath.join(tools, "release", "gh_test", "bin");
  roots.push(tools);
  await NodeFSP.mkdir(release, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(release, "gh"), '#!/bin/sh\necho "gh $GH_CONFIG_DIR"\n', {
    mode: 0o755,
  });
  NodeChildProcess.execFileSync("tar", ["-czf", "../gh.tar.gz", "gh_test"], {
    cwd: NodePath.join(tools, "release"),
  });

  const bin = NodePath.join(tools, "bin");
  await NodeFSP.mkdir(bin);

  for (const tool of TOOLS) {
    const path = NodeChildProcess.execFileSync("sh", ["-c", `command -v ${tool}`], {
      encoding: "utf8",
    }).trim();

    await NodeFSP.symlink(path, NodePath.join(bin, tool));
  }

  const log = NodePath.join(tools, "downloads");
  await NodeFSP.writeFile(
    NodePath.join(bin, "curl"),
    `#!/bin/sh\necho "$2" >> '${log}'\ncp '${NodePath.join(tools, "gh.tar.gz")}' "$4"\n`,
    { mode: 0o755 },
  );

  return {
    path: bin,
    downloads: async () => (await NodeFSP.readFile(log, "utf8")).split("\n").filter(Boolean),
  };
}

async function localComputer() {
  const root = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "otto-gh-")),
  );

  roots.push(root);
  const tools = await computerTools(root);

  const workspace = new Workspace({
    id: "computer",
    name: "computer",
    filesystem: new LocalFilesystem({ basePath: root }),
    sandbox: new LocalSandbox({ workingDirectory: root, env: { PATH: tools.path } }),
  });

  const sandbox = workspace.sandbox!;
  const commands = vi.spyOn(sandbox, "executeCommand");

  const computer = {
    ...wrap(workspace, "local"),
    writePrivateFile: (path: string, content: string) =>
      NodeFSP.writeFile(path, content, { mode: 0o600 }),
  };

  const run = async (command: string, env: Readonly<Record<string, string>>) => {
    const result = await withCommandEnvironment(workspace, env).sandbox!.executeCommand!(
      command,
      [],
    );

    return result.stdout.trim();
  };

  return { root, computer, commands, run, downloads: tools.downloads };
}

const ana = { githubId: 42, login: "ana", name: 'Ana "Q" Gómez', accessToken: TOKEN };

describe("bot GitHub logins", () => {
  it("installs gh once and logs git and gh in as the asker for one chat without the token in any command", async () => {
    const { root, computer, commands, run, downloads } = await localComputer();

    const logins = createBotGitHubLogins({
      turnLogin: async (personId) => (personId === "person-ana" ? ana : undefined),
      computer: () => computer,
    });

    const env = await logins.start("thread-1", "person-ana");

    expect(env).toBeDefined();
    expect(JSON.stringify(env)).not.toContain(TOKEN);
    expect(await run("git config user.name", env!)).toBe('Ana "Q" Gómez');
    expect(await run("git config user.email", env!)).toBe("42+ana@users.noreply.github.com");
    expect(await run("gh", env!)).toBe(`gh ${env!.GH_CONFIG_DIR}`);
    expect(await run("git config otto.installurl", env!)).toBe(
      "https://github.com/apps/otto-by-hello-gafaro/installations/new",
    );
    expect(
      await run("printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill", env!),
    ).toContain(`password=${TOKEN}`);
    expect(
      await NodeFSP.readFile(NodePath.join(env!.GH_CONFIG_DIR!, "hosts.yml"), "utf8"),
    ).toContain(`oauth_token: ${TOKEN}`);

    const folder = NodePath.dirname(env!.GIT_CONFIG_GLOBAL!);
    expect(folder.startsWith(NodePath.join(root, ".otto", "github"))).toBe(true);
    expect((await NodeFSP.stat(folder)).mode & 0o777).toBe(0o700);
    expect((await NodeFSP.stat(NodePath.join(folder, "git-credentials"))).mode & 0o777).toBe(0o600);

    await logins.end("thread-1");
    await expect(NodeFSP.stat(folder)).rejects.toThrow();

    const next = await logins.start("thread-1", "person-ana");

    expect(await run("gh", next!)).toBe(`gh ${next!.GH_CONFIG_DIR}`);
    expect(await downloads()).toEqual([
      expect.stringMatching(
        /^https:\/\/github\.com\/cli\/cli\/releases\/download\/v[\d.]+\/gh_[\d.]+_(linux|macOS)_(amd64|arm64)\.(tar\.gz|zip)$/,
      ),
    ]);
    expect(NodePath.dirname(await run("command -v gh", next!))).toBe(
      NodePath.join(root, ".otto", "bin"),
    );

    for (const call of commands.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(TOKEN);
    }
  });

  it("gives each chat its own person and writes nothing for someone without a link", async () => {
    const { computer, run } = await localComputer();
    const ben = { githubId: 7, login: "ben", name: null, accessToken: "ghu_ben" };

    const people = new Map<string, GitHubTurnLogin>([
      ["person-ana", ana],
      ["person-ben", ben],
    ]);

    const logins = createBotGitHubLogins({
      turnLogin: async (personId) => people.get(personId),
      computer: () => computer,
    });

    const anas = await logins.start("thread-ana", "person-ana");

    const bens = await logins.start("thread-ben", "person-ben");

    expect(await run("git config user.email", anas!)).toBe("42+ana@users.noreply.github.com");
    expect(await run("git config user.name", bens!)).toBe("ben");

    const none = await logins.start("thread-cleo", "person-cleo");

    expect(none).toBeUndefined();
  });
});
