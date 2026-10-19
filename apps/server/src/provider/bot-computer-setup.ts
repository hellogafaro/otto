import * as NodeCrypto from "node:crypto";

import type { GitHubTurnLogin } from "../github/github-accounts.ts";
import { removeGitHubLogin, writeGitHubLogin } from "./bot-github-login.ts";
import type { OttoBotWorkspace } from "./workspace/bot-workspace-types.ts";

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

const GH_VERSION = "2.102.0";

/** A command found on the computer, and the package that brings it when it is missing. */
const DESKTOP_TOOLS = [
  "import:imagemagick",
  "scrot:scrot",
  "xdotool:xdotool",
  "wmctrl:wmctrl",
  "ffmpeg:ffmpeg",
];

/**
 * The tools every bot computer gets: gh from its official release in the computer's own
 * `.otto/bin`, and on remote computers git plus, when there is a screen, the computer-use
 * tools, from the system's apt. Local computers never get system packages. A computer that
 * finished this exact script skips it; one whose gh download failed tries again next turn,
 * while missing system packages are tried once. It prints the PATH that finds gh when gh lives
 * in `.otto/bin`.
 */
const toolbox = (remote: boolean) => {
  const body = [
    'o="$PWD/.otto"; b="$o/bin"; ok=1',
    'if ! command -v gh >/dev/null 2>&1 && [ ! -x "$b/gh" ]; then',
    '  case "$(uname -s)_$(uname -m)" in',
    "    Linux_x86_64) a=linux_amd64.tar.gz ;;",
    "    Linux_aarch64 | Linux_arm64) a=linux_arm64.tar.gz ;;",
    "    Darwin_x86_64) a=macOS_amd64.zip ;;",
    "    Darwin_arm64) a=macOS_arm64.zip ;;",
    "    *) a= ;;",
    "  esac",
    '  if [ -n "$a" ]; then',
    `    u="https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_$a"`,
    '    mkdir -p "$b" && x=$(mktemp -d "$b/.gh.XXXXXX") && {',
    '      { curl -fsSL --max-time 120 "$u" -o "$x/a" || wget -qO "$x/a" "$u"; } && tar -xf "$x/a" -C "$x" && mv "$x"/gh_*/bin/gh "$b/gh" || ok=0',
    '      rm -rf "$x"',
    "    } || ok=0",
    "  fi",
    "fi",
    ...(remote
      ? [
          '[ "$(id -u)" = 0 ] && s= || s="sudo -n"',
          'if [ -x "$b/gh" ] && ! command -v gh >/dev/null 2>&1; then',
          '  ln -sf "$b/gh" /usr/local/bin/gh 2>/dev/null || $s ln -sf "$b/gh" /usr/local/bin/gh 2>/dev/null',
          "fi",
          "command -v git >/dev/null 2>&1 && p= || p=git",
          'if [ -n "${DISPLAY:-}" ]; then',
          `  for t in ${DESKTOP_TOOLS.join(" ")}; do command -v "${"$"}{t%%:*}" >/dev/null 2>&1 || p="$p ${"$"}{t#*:}"; done`,
          "fi",
          'if [ -n "$p" ] && command -v apt-get >/dev/null 2>&1; then',
          "  { $s apt-get update -qq && $s env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends $p; } >/dev/null 2>&1",
          "fi",
        ]
      : []),
  ].join("\n");

  const version = NodeCrypto.createHash("sha256").update(body).digest("hex").slice(0, 16);

  return [
    'o="$PWD/.otto"',
    `if [ "$(cat "$o/setup" 2>/dev/null)" != ${version} ]; then (`,
    body,
    `[ "$ok" = 1 ] && mkdir -p "$o" && printf %s ${version} > "$o/setup"`,
    "); fi",
    'if [ -x "$o/bin/gh" ]; then printf \'%s:%s\' "$o/bin" "$PATH"; fi',
  ].join("\n");
};

/**
 * The repositories among a project's links: `github.com/<owner>/<repo>` and
 * `gitlab.com/<group>/.../<project>`, whatever page of it the link opens.
 */
export function projectRepositories(links: readonly string[]): readonly string[] {
  const repositories = links.flatMap((link) => {
    const url = URL.parse(link);
    const host = url?.hostname.toLowerCase();
    const path = url?.pathname.split("/").filter(Boolean) ?? [];

    if (host === "github.com" && path.length >= 2)
      return [`github.com/${path[0]}/${path[1]!.replace(/\.git$/, "")}`];

    if (host !== "gitlab.com") return [];
    const end = path.indexOf("-");
    const project = end === -1 ? path : path.slice(0, end);

    return project.length >= 2 ? [`gitlab.com/${project.join("/").replace(/\.git$/, "")}`] : [];
  });

  return [...new Set(repositories)].filter((repository) => /^[\w.\-/]+$/.test(repository));
}

/**
 * Clones each repository that is not on the computer yet into `repos/<path>`, with the turn's
 * git login, so private GitHub repositories the asker can read come too. A clone that fails,
 * such as a private GitLab project, leaves nothing behind and is tried again next turn.
 */
const cloneRepositories = (repositories: readonly string[]) =>
  repositories
    .map((repository) => {
      const folder = quote(repository.slice(repository.indexOf("/") + 1));

      return [
        `d="$PWD/repos/"${folder}`,
        '[ -e "$d" ] || {',
        '  rm -rf "$d.clone" && mkdir -p "$(dirname "$d")" &&',
        `  GIT_TERMINAL_PROMPT=0 git clone -q ${quote(`https://${repository}.git`)} "$d.clone" >/dev/null 2>&1 && mv "$d.clone" "$d" ||`,
        '  { rm -rf "$d.clone"; rmdir "$(dirname "$d")" 2>/dev/null; }',
        "}",
      ].join("\n");
    })
    .join("\n");

/**
 * Prepares the chat's computer for each turn, and cleans up after it. The sandbox already
 * starts at the computer root. A turn a person asked for also gets the toolbox once, that
 * person's GitHub login, and the project's repositories cloned into `repos/`. Nothing logs in
 * when that person has not linked GitHub, so git and gh say they are not logged in and the bot
 * asks them to connect.
 */
export function createBotComputerSetup(deps: {
  readonly turnLogin: (personId: string) => Promise<GitHubTurnLogin | undefined>;
  /** The links in the resources of the chat's project. */
  readonly projectLinks: (threadId: string) => Promise<readonly string[]>;
  readonly computer: (threadId: string) => OttoBotWorkspace | undefined;
}) {
  const written = new Map<string, OttoBotWorkspace>();
  const queues = new Map<string, Promise<unknown>>();

  // One chat's setups and cleanups run in order, so a finished turn's cleanup never lands
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

  // The toolbox and repositories are a convenience: a computer that cannot get them still
  // gets its login.
  const tools = async (computer: OttoBotWorkspace) => {
    const result = await computer.workspace.sandbox
      ?.executeCommand?.(toolbox(computer.provider !== "local"), [], { timeout: 300_000 })
      .catch(() => undefined);

    const path = result?.exitCode === 0 ? result.stdout.trim() : "";

    return path ? { PATH: path } : {};
  };

  // A turn for nobody on a chat with nothing written skips the queue, so it starts at once.
  const start = (threadId: string, askerPersonId: string | null) =>
    !askerPersonId && !written.has(threadId) && !queues.has(threadId)
      ? undefined
      : queued(threadId, async (): Promise<Readonly<Record<string, string>> | undefined> => {
          await remove(threadId);
          const computer = deps.computer(threadId);

          if (!computer || !askerPersonId) return undefined;
          const toolEnvironment = await tools(computer);

          const login = computer.writePrivateFile ? await deps.turnLogin(askerPersonId) : undefined;

          if (login) written.set(threadId, computer);

          const loginEnvironment = login
            ? await writeGitHubLogin({ computer, threadId, login })
            : undefined;

          const environment = { ...toolEnvironment, ...loginEnvironment };
          const repositories = projectRepositories(await deps.projectLinks(threadId));

          if (repositories.length > 0)
            await computer.workspace.sandbox
              ?.executeCommand?.(cloneRepositories(repositories), [], {
                env: environment,
                timeout: 600_000,
              })
              .catch(() => undefined);

          return Object.keys(environment).length > 0 ? environment : undefined;
        });

  const end = (threadId: string) =>
    written.has(threadId) || queues.has(threadId)
      ? queued(threadId, () => remove(threadId))
      : undefined;

  return { start, end };
}
