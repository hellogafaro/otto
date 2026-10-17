import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createBotGitHubLogins } from "./bot-github-login.ts";
import { withCommandEnvironment } from "./tools/otto-workspace-tools.ts";
import { wrap } from "./workspace/bot-workspace-lifecycle.ts";

const TOKEN = "ghu_secretToken123";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFs.rm(root, { recursive: true, force: true })),
  );
});

async function localComputer() {
  const root = await NodeFs.realpath(
    await NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "otto-gh-")),
  );
  roots.push(root);

  const workspace = new Workspace({
    id: "computer",
    name: "computer",
    filesystem: new LocalFilesystem({ basePath: root }),
    sandbox: new LocalSandbox({ workingDirectory: root }),
  });

  const sandbox = workspace.sandbox!;
  const commands = vi.spyOn(sandbox, "executeCommand");

  const computer = {
    ...wrap(workspace, "local"),
    writePrivateFile: (path: string, content: string) =>
      NodeFs.writeFile(path, content, { mode: 0o600 }),
  };

  const run = async (command: string, env: Readonly<Record<string, string>>) => {
    const result = await withCommandEnvironment(workspace, env).sandbox!.executeCommand!(
      command,
      [],
    );

    return result.stdout.trim();
  };

  return { root, computer, commands, run };
}

const ana = { githubId: 42, login: "ana", name: 'Ana "Q" Gómez', accessToken: TOKEN };

describe("bot GitHub logins", () => {
  it("logs git and gh in as the asker for one chat without the token in any command", async () => {
    const { root, computer, commands, run } = await localComputer();

    const logins = createBotGitHubLogins({
      turnLogin: async (personId) => (personId === "person-ana" ? ana : undefined),
      computer: () => computer,
    });

    const env = await logins.start("thread-1", "person-ana");

    expect(env).toBeDefined();
    expect(JSON.stringify(env)).not.toContain(TOKEN);
    expect(await run("git config user.name", env!)).toBe('Ana "Q" Gómez');
    expect(await run("git config user.email", env!)).toBe("42+ana@users.noreply.github.com");
    expect(await run("git config otto.installurl", env!)).toBe(
      "https://github.com/apps/otto-by-hello-gafaro/installations/new",
    );
    expect(
      await run("printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill", env!),
    ).toContain(`password=${TOKEN}`);
    expect(
      await NodeFs.readFile(NodePath.join(env!.GH_CONFIG_DIR!, "hosts.yml"), "utf8"),
    ).toContain(`oauth_token: ${TOKEN}`);

    const folder = NodePath.dirname(env!.GIT_CONFIG_GLOBAL!);
    expect(folder.startsWith(NodePath.join(root, ".otto", "github"))).toBe(true);
    expect((await NodeFs.stat(folder)).mode & 0o777).toBe(0o700);
    expect((await NodeFs.stat(NodePath.join(folder, "git-credentials"))).mode & 0o777).toBe(0o600);

    await logins.end("thread-1");
    await expect(NodeFs.stat(folder)).rejects.toThrow();

    for (const call of commands.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(TOKEN);
    }
  });

  it("gives each chat its own person and writes nothing for someone without a link", async () => {
    const { computer, run } = await localComputer();
    const ben = { githubId: 7, login: "ben", name: null, accessToken: "ghu_ben" };

    const logins = createBotGitHubLogins({
      turnLogin: async (personId) =>
        personId === "person-ana" ? ana : personId === "person-ben" ? ben : undefined,
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
