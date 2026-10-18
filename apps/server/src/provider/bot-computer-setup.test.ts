import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { GitHubTurnLogin } from "../github/github-accounts.ts";
import { createBotComputerSetup } from "./bot-computer-setup.ts";
import { withCommandEnvironment } from "./tools/otto-workspace-tools.ts";
import { wrap } from "./workspace/bot-workspace-lifecycle.ts";

const TOKEN = "ghu_secretToken123";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});

const TOOLS = [
  "sh",
  "cat",
  "cp",
  "dirname",
  "mkdir",
  "chmod",
  "rm",
  "rmdir",
  "mv",
  "mktemp",
  "uname",
  "tar",
  "gzip",
];

const sh = (command: string, cwd?: string) =>
  NodeChildProcess.execFileSync("sh", ["-c", command], { encoding: "utf8", cwd }).trim();

/**
 * The tools of a computer without gh. Its curl serves a gh release archive from disk and logs
 * each URL, and its git clones https remotes from local folders, so setup runs for real
 * without the network.
 */
async function computerTools(root: string) {
  const tools = `${root}-tools`;
  const bin = NodePath.join(tools, "bin");
  const release = NodePath.join(tools, "release", "gh_test", "bin");
  roots.push(tools);
  await NodeFSP.mkdir(release, { recursive: true });
  await NodeFSP.mkdir(bin);
  await NodeFSP.writeFile(NodePath.join(release, "gh"), '#!/bin/sh\necho "gh $GH_CONFIG_DIR"\n', {
    mode: 0o755,
  });
  sh("tar -czf ../gh.tar.gz gh_test", NodePath.join(tools, "release"));

  for (const tool of TOOLS)
    await NodeFSP.symlink(sh(`command -v ${tool}`), NodePath.join(bin, tool));
  const downloads = NodePath.join(tools, "downloads");

  await NodeFSP.writeFile(
    NodePath.join(bin, "curl"),
    `#!/bin/sh\nfor a; do case "$a" in https://*) echo "$a" >> '${downloads}' ;; esac; o="$a"; done\ncp '${tools}/gh.tar.gz' "$o"\n`,
    { mode: 0o755 },
  );

  await NodeFSP.writeFile(
    NodePath.join(bin, "git"),
    `#!/bin/sh\nGIT_CONFIG_NOSYSTEM=1 exec '${sh("command -v git")}' -c 'url.file://${tools}/origins/.insteadOf=https://' "$@"\n`,
    { mode: 0o755 },
  );

  const origin = async (path: string) => {
    const folder = NodePath.join(tools, "origins", path);
    await NodeFSP.mkdir(folder, { recursive: true });
    sh(
      `git init -q --bare && git --work-tree=. -c user.name=o -c user.email=o@o commit -q --allow-empty -m first`,
      folder,
    );
  };

  return {
    path: bin,
    origin,
    downloads: async () =>
      (await NodeFSP.readFile(downloads, "utf8").catch(() => "")).split("\n").filter(Boolean),
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

  return { root, computer, commands, run, tools };
}

const ana = { githubId: 42, login: "ana", name: 'Ana "Q" Gómez', accessToken: TOKEN };

describe("bot computer setup", () => {
  it("installs gh once and logs git and gh in as the asker without the token in any command", async () => {
    const { root, computer, commands, run, tools } = await localComputer();

    const logins = createBotComputerSetup({
      turnLogin: async (personId) => (personId === "person-ana" ? ana : undefined),
      projectLinks: async () => [],
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

    const next = await createBotComputerSetup({
      turnLogin: async () => ana,
      projectLinks: async () => [],
      computer: () => computer,
    }).start("thread-1", "person-ana");

    expect(await run("gh", next!)).toBe(`gh ${next!.GH_CONFIG_DIR}`);
    expect(await run("command -v gh", next!)).toBe(NodePath.join(root, ".otto", "bin", "gh"));
    expect(await tools.downloads()).toEqual([
      expect.stringMatching(
        /^https:\/\/github\.com\/cli\/cli\/releases\/download\/v[\d.]+\/gh_[\d.]+_(linux|macOS)_(amd64|arm64)\.(tar\.gz|zip)$/,
      ),
    ]);

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

    const logins = createBotComputerSetup({
      turnLogin: async (personId) => people.get(personId),
      projectLinks: async () => [],
      computer: () => computer,
    });

    const anas = await logins.start("thread-ana", "person-ana");

    const bens = await logins.start("thread-ben", "person-ben");

    expect(await run("git config user.email", anas!)).toBe("42+ana@users.noreply.github.com");
    expect(await run("git config user.name", bens!)).toBe("ben");

    const none = await logins.start("thread-cleo", "person-cleo");

    expect(none).not.toHaveProperty("GIT_CONFIG_GLOBAL");
    expect(none).not.toHaveProperty("GH_CONFIG_DIR");
  });

  it("clones the repositories linked in the project once, for someone without a login", async () => {
    const { root, computer, tools } = await localComputer();
    await tools.origin("github.com/acme/app.git");
    await tools.origin("gitlab.com/team/sub/tool.git");

    const setup = createBotComputerSetup({
      turnLogin: async () => undefined,
      projectLinks: async () => [
        "https://github.com/acme/app/pull/3",
        "https://github.com/acme/app.git",
        "https://gitlab.com/team/sub/tool/-/issues/1",
        "https://github.com/acme",
        "https://github.com/acme/private",
        "https://github.com/other/private",
        "https://example.com/acme/app",
      ],
      computer: () => computer,
    });

    await setup.start("thread-1", "person-cleo");
    const repos = NodePath.join(root, "repos");

    expect(sh("git log --format=%s", NodePath.join(repos, "acme", "app"))).toBe("first");
    expect(sh("git log --format=%s", NodePath.join(repos, "team", "sub", "tool"))).toBe("first");
    expect((await NodeFSP.readdir(repos)).sort()).toEqual(["acme", "team"]);
    expect(await NodeFSP.readdir(NodePath.join(repos, "acme"))).toEqual(["app"]);

    await NodeFSP.writeFile(NodePath.join(repos, "acme", "app", "work"), "kept");
    await setup.start("thread-1", "person-cleo");

    expect(await NodeFSP.readFile(NodePath.join(repos, "acme", "app", "work"), "utf8")).toBe(
      "kept",
    );
  });
});
