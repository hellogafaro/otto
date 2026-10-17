import * as NodeCrypto from "node:crypto";

import { GITHUB_INSTALL_URL, type GitHubTurnLogin } from "../github/github-accounts.ts";
import type { OttoBotWorkspace } from "./workspace/bot-workspace-types.ts";

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** A git config value in double quotes, so names and paths with spaces or quotes stay intact. */
const configValue = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ")}"`;

/** The chat's own folder, so two chats on one bot computer each keep their own person's login. */
const loginFolder = (threadId: string) =>
  `"$PWD/.otto/github/${NodeCrypto.createHash("sha256").update(threadId).digest("hex").slice(0, 16)}"`;

/**
 * Writes one person's GitHub login for one chat into the bot's computer and returns the
 * path-only environment that points git and gh at it. The token goes only into files, written
 * through the computer's file API; it is never part of a command, argument or environment value.
 */
export async function writeGitHubLogin(input: {
  readonly computer: OttoBotWorkspace;
  readonly threadId: string;
  readonly login: GitHubTurnLogin;
}): Promise<Readonly<Record<string, string>> | undefined> {
  const sandbox = input.computer.workspace.sandbox;
  const writePrivateFile = input.computer.writePrivateFile;

  if (!sandbox?.executeCommand || !writePrivateFile) return undefined;

  const prepared = await sandbox.executeCommand(
    `d=${loginFolder(input.threadId)} && mkdir -p "$d/gh" && chmod 700 "$PWD/.otto" "$PWD/.otto/github" "$d" "$d/gh" && printf '%s\\n%s' "$d" "\${HOME:-}"`,
    [],
  );

  if (prepared.exitCode !== 0) throw new Error("Could not prepare the GitHub login folder.");
  const [folder = "", home = ""] = prepared.stdout.trim().split("\n");

  if (!folder.startsWith("/")) throw new Error("Could not prepare the GitHub login folder.");
  const { login, accessToken } = input.login;

  const files = {
    "git-credentials": `https://${encodeURIComponent(login)}:${accessToken}@github.com\n`,
    "gh/hosts.yml": [
      "github.com:",
      "    users:",
      `        ${login}:`,
      `            oauth_token: ${accessToken}`,
      "    git_protocol: https",
      `    oauth_token: ${accessToken}`,
      `    user: ${login}`,
      "",
    ].join("\n"),
    gitconfig: [
      ...(home.startsWith("/")
        ? ["[include]", `\tpath = ${configValue(`${home}/.gitconfig`)}`]
        : []),
      "[user]",
      `\tname = ${configValue(input.login.name ?? login)}`,
      `\temail = ${configValue(`${input.login.githubId}+${login}@users.noreply.github.com`)}`,
      '[credential "https://github.com"]',
      "\thelper =",
      `\thelper = ${configValue(`store --file=${folder}/git-credentials`)}`,
      "[otto]",
      `\tinstallurl = ${configValue(GITHUB_INSTALL_URL)}`,
      "",
    ].join("\n"),
  };

  for (const [name, content] of Object.entries(files)) {
    await writePrivateFile(`${folder}/${name}`, content);
  }

  const locked = await sandbox.executeCommand(
    `chmod 600 ${Object.keys(files)
      .map((name) => quote(`${folder}/${name}`))
      .join(" ")}`,
    [],
  );

  if (locked.exitCode !== 0) throw new Error("Could not lock the GitHub login folder.");

  return { GIT_CONFIG_GLOBAL: `${folder}/gitconfig`, GH_CONFIG_DIR: `${folder}/gh` };
}

/** Deletes a chat's GitHub login from the bot's computer. */
export async function removeGitHubLogin(
  computer: OttoBotWorkspace,
  threadId: string,
): Promise<void> {
  await computer.workspace.sandbox?.executeCommand?.(`rm -rf -- ${loginFolder(threadId)}`, []);
}

/**
 * Gives each turn the GitHub login of the person it acts for, and takes it away when the turn
 * ends. Nothing is written when that person has not linked GitHub, so git and gh say they are
 * not logged in and the bot asks them to connect.
 *
 * Known limit: a bot's chats share one computer and one system user, so a turn running at the
 * same time in another chat of the same bot can read this folder. The token it holds is a
 * GitHub App user token that expires within 8 hours and is deleted when the turn ends.
 */
export function createBotGitHubLogins(deps: {
  readonly turnLogin: (personId: string) => Promise<GitHubTurnLogin | undefined>;
  readonly computer: (threadId: string) => OttoBotWorkspace | undefined;
}) {
  const written = new Map<string, OttoBotWorkspace>();
  const queues = new Map<string, Promise<unknown>>();

  // One chat's writes and removals run in order, so a finished turn's cleanup never lands
  // after the next turn's login.
  const queued = <A>(threadId: string, run: () => Promise<A>): Promise<A> => {
    const next = (queues.get(threadId) ?? Promise.resolve()).catch(() => undefined).then(run);
    queues.set(threadId, next);
    void next
      .catch(() => undefined)
      .then(() => queues.get(threadId) === next && queues.delete(threadId));

    return next;
  };

  const remove = async (threadId: string) => {
    const computer = written.get(threadId);

    if (!computer) return;
    written.delete(threadId);
    await removeGitHubLogin(computer, threadId);
  };

  // A turn for nobody on a chat with nothing written skips the queue, so it starts at once.
  const start = (threadId: string, askerPersonId: string | null) =>
    !askerPersonId && !written.has(threadId) && !queues.has(threadId)
      ? undefined
      : queued(threadId, async () => {
          await remove(threadId);
          const computer = deps.computer(threadId);

          if (!computer?.writePrivateFile || !askerPersonId) return undefined;
          const login = await deps.turnLogin(askerPersonId);

          if (!login) return undefined;
          written.set(threadId, computer);

          return writeGitHubLogin({ computer, threadId, login });
        });

  const end = (threadId: string) =>
    written.has(threadId) || queues.has(threadId)
      ? queued(threadId, () => remove(threadId))
      : undefined;

  return { start, end };
}
