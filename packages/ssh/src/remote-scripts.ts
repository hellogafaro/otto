import type { DesktopSshEnvironmentTarget } from "@otto/contracts";
import { satisfiesSemverRange } from "@otto/shared/semver";
import { remoteStateKey } from "./command.ts";
import {
  DEFAULT_REMOTE_PORT,
  REMOTE_PORT_SCAN_WINDOW,
  SSH_READY_PROBE_TIMEOUT_MS,
  REMOTE_READY_TIMEOUT_MS,
  REMOTE_REUSE_READY_TIMEOUT_MS,
  type RemoteOttoLegacyRunnerOptions,
} from "./types.ts";

const remoteNodeEngineCheckMain = function remoteNodeEngineCheckMain() {
  const range = process.argv[2] || "";

  const rawVersion =
    process.versions && process.versions.node ? process.versions.node : process.version;

  if (!satisfiesSemverRange(rawVersion, range)) {
    process.stderr.write(
      "Remote node " + rawVersion + " does not satisfy required range " + range + ".\n",
    );
    process.exit(1);
  }
};

function buildRemoteNodeEngineCheckScript(): string {
  return `${satisfiesSemverRange.toString()}
(${remoteNodeEngineCheckMain.toString()})();`;
}

function stripTrailingNewlines(value: string): string {
  return value.replace(/\n+$/u, "");
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function applyScriptPlaceholders(
  template: string,
  replacements: Readonly<Record<string, string>>,
): string {
  let result = template;

  for (const [token, value] of Object.entries(replacements)) {
    result = result.replaceAll(`@@${token}@@`, value);
  }

  return result;
}

export const REMOTE_PICK_PORT_SCRIPT = `const fs = require("node:fs");
const net = require("node:net");
const filePath = process.argv[2] ?? "";
const defaultPort = Number.parseInt(process.argv[3] ?? "", 10);
const scanWindow = Number.parseInt(process.argv[4] ?? "", 10);
const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8").trim() : "";
const preferred = Number.parseInt(raw, 10);
const start = Number.isInteger(preferred) ? preferred : defaultPort;
const end = start + scanWindow;

function tryPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => resolve(error ? false : port));
    });
  });
}

(async () => {
  for (let port = start; port < end; port += 1) {
    const available = await tryPort(port);
    if (available) {
      process.stdout.write(String(port));
      return;
    }
  }
  process.exit(1);
})().catch(() => process.exit(1));
`;

export const REMOTE_WAIT_READY_SCRIPT = `const http = require("node:http");
const port = Number.parseInt(process.argv[2] ?? "", 10);
const timeoutMs = Number.parseInt(process.argv[3] ?? "", 10);
const probeTimeoutMs = Number.parseInt(process.argv[4] ?? "", 10);
if (!Number.isInteger(port) || !Number.isInteger(timeoutMs) || !Number.isInteger(probeTimeoutMs)) {
  process.exit(1);
}
const deadline = Date.now() + timeoutMs;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probe() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        timeout: probeTimeoutMs,
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          resolve(response.statusCode >= 200 && response.statusCode < 300);
        });
      },
    );
    request.once("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.once("error", () => resolve(false));
  });
}

(async () => {
  while (Date.now() < deadline) {
    if (await probe()) {
      process.exit(0);
    }
    await sleep(100);
  }
  process.exit(1);
})().catch(() => process.exit(1));
`;

export const REMOTE_NODE_ENV_SCRIPT = `prepend_path_if_dir() {
  if [ -d "$1" ]; then
    case ":$PATH:" in
      *":$1:"*) ;;
      *) PATH="$1:$PATH" ;;
    esac
  fi
}

remote_node_satisfies_engine() {
  OTTO_LEGACY_NODE_ENGINE_RANGE=@@OTTO_LEGACY_NODE_ENGINE_RANGE@@
  if [ -z "$OTTO_LEGACY_NODE_ENGINE_RANGE" ]; then
    return 0
  fi
  node - "$OTTO_LEGACY_NODE_ENGINE_RANGE" <<'NODE'
@@OTTO_LEGACY_NODE_ENGINE_CHECK_SCRIPT@@
NODE
}

ensure_remote_node_path() {
  if command -v node >/dev/null 2>&1 && remote_node_satisfies_engine >/dev/null 2>&1; then
    return 0
  fi

  prepend_path_if_dir "$HOME/.local/bin"
  prepend_path_if_dir "$HOME/bin"
  prepend_path_if_dir "/opt/homebrew/bin"
  prepend_path_if_dir "/usr/local/bin"
  prepend_path_if_dir "/usr/bin"
  prepend_path_if_dir "/bin"

  if [ -z "\${VOLTA_HOME:-}" ]; then
    VOLTA_HOME="$HOME/.volta"
  fi
  export VOLTA_HOME
  prepend_path_if_dir "$VOLTA_HOME/bin"

  prepend_path_if_dir "$HOME/.asdf/shims"
  prepend_path_if_dir "$HOME/.asdf/bin"
  if [ ! -x "$HOME/.asdf/shims/node" ] && [ -s "$HOME/.asdf/asdf.sh" ]; then
    # shellcheck disable=SC1090
    . "$HOME/.asdf/asdf.sh"
  fi

  prepend_path_if_dir "$HOME/.local/share/mise/shims"
  prepend_path_if_dir "$HOME/.mise/shims"
  if ! command -v node >/dev/null 2>&1 && command -v mise >/dev/null 2>&1; then
    eval "$(mise activate sh)" >/dev/null 2>&1 || true
  fi

  if [ -z "\${FNM_DIR:-}" ]; then
    FNM_DIR="$HOME/.local/share/fnm"
  fi
  export FNM_DIR
  prepend_path_if_dir "$FNM_DIR"
  prepend_path_if_dir "$HOME/.fnm"
  if ! command -v node >/dev/null 2>&1 && command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --shell bash)" >/dev/null 2>&1 || true
    fnm use --silent-if-unchanged >/dev/null 2>&1 || fnm use default >/dev/null 2>&1 || true
  fi

  prepend_path_if_dir "$HOME/.nodenv/bin"
  prepend_path_if_dir "$HOME/.nodenv/shims"
  if ! command -v node >/dev/null 2>&1 && command -v nodenv >/dev/null 2>&1; then
    eval "$(nodenv init -)" >/dev/null 2>&1 || true
  fi

  if [ -z "\${NVM_DIR:-}" ]; then
    NVM_DIR="$HOME/.nvm"
  fi
  export NVM_DIR

  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    if ! command -v node >/dev/null 2>&1 && command -v nvm >/dev/null 2>&1; then
      nvm use --silent default >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1 || nvm use --silent --lts >/dev/null 2>&1 || true
    fi
  fi

  if ! command -v node >/dev/null 2>&1 && [ -d "$NVM_DIR/versions/node" ]; then
    for OTTO_LEGACY_NODE_BIN in "$NVM_DIR"/versions/node/*/bin; do
      if [ -x "$OTTO_LEGACY_NODE_BIN/node" ]; then
        PATH="$OTTO_LEGACY_NODE_BIN:$PATH"
        export PATH
      fi
    done
  fi

  command -v node >/dev/null 2>&1 && remote_node_satisfies_engine
}
`;

export const REMOTE_RUNNER_SCRIPT = `#!/bin/sh
set -eu
@@OTTO_LEGACY_NODE_ENV_SCRIPT@@
ensure_remote_node_path || true
OTTO_LEGACY_NODE_SCRIPT_PATH=@@OTTO_LEGACY_NODE_SCRIPT_PATH@@
if [ -n "$OTTO_LEGACY_NODE_SCRIPT_PATH" ]; then
  if ! command -v node >/dev/null 2>&1; then
    printf 'Remote host is missing node on PATH. Install Node or configure a supported version manager for non-interactive shells.\\n' >&2
    exit 1
  fi
  exec node "$OTTO_LEGACY_NODE_SCRIPT_PATH" "$@"
fi
if command -v otto >/dev/null 2>&1; then
  exec otto "$@"
fi
if [ -z @@OTTO_LEGACY_PACKAGE_SPEC@@ ]; then
  printf 'Remote host is missing the Otto CLI. No npm package is configured for this fork; install a trusted Otto CLI or configure its node script path.\\n' >&2
  exit 1
fi
# npm extracts a package before it runs the native builds of its dependencies,
# so a failed build (otto depends on node-pty, which needs a C toolchain) leaves
# the npx cache without an otto executable. \`npx --yes\` then exits 0 without
# running anything at all, which the caller only ever sees as a server that
# never becomes ready. Resolve the CLI once up front so that install failure is
# reported here, with npm's own output on stderr.
require_installed_otto_cli() {
  if ! OTTO_LEGACY_CLI_PATH="$("$@" -- sh -c 'command -v otto')"; then
    printf 'Remote host could not install %s. See npm output above for the cause.\\n' @@OTTO_LEGACY_PACKAGE_SPEC@@ >&2
    return 1
  fi
  if [ -n "$OTTO_LEGACY_CLI_PATH" ]; then
    return 0
  fi
  printf 'Remote host installed %s but npm produced no otto executable, which usually means a native dependency (node-pty) failed to build. Install a C toolchain on the remote host (Debian/Ubuntu: build-essential, Fedora/RHEL: gcc-c++ make, macOS: xcode-select --install) and try again.\\n' @@OTTO_LEGACY_PACKAGE_SPEC@@ >&2
  return 1
}
# The launcher records this PID, so exec the CLI without an npm wrapper process.
if command -v npx >/dev/null 2>&1; then
  require_installed_otto_cli npx --yes --package @@OTTO_LEGACY_PACKAGE_SPEC@@ || exit 1
  exec "$OTTO_LEGACY_CLI_PATH" "$@"
fi
if command -v npm >/dev/null 2>&1; then
  require_installed_otto_cli npm exec --yes --package @@OTTO_LEGACY_PACKAGE_SPEC@@ || exit 1
  exec "$OTTO_LEGACY_CLI_PATH" "$@"
fi
printf 'Remote host is missing the otto CLI and could not install @@OTTO_LEGACY_PACKAGE_SPEC@@ because node/npm/npx are unavailable on PATH. Install Node or configure a supported version manager for non-interactive shells.\\n' >&2
exit 1
`;

export const REMOTE_LAUNCH_SCRIPT = `set -eu
@@OTTO_LEGACY_NODE_ENV_SCRIPT@@
STATE_KEY="$1"
STATE_DIR="$HOME/.ottoLegacy/ssh-launch/$STATE_KEY"
DEFAULT_SERVER_HOME="$HOME/.ottoLegacy"
DEFAULT_RUNTIME_FILE="$DEFAULT_SERVER_HOME/userdata/server-runtime.json"
PORT_FILE="$STATE_DIR/port"
PID_FILE="$STATE_DIR/pid"
MANAGED_FILE="$STATE_DIR/managed"
LOG_FILE="$STATE_DIR/server.log"
RUNNER_FILE="$STATE_DIR/run-ottoLegacy.sh"
RUNNER_NEXT="$STATE_DIR/run-ottoLegacy.next.$$"
mkdir -p "$STATE_DIR"
cleanup_runner_next() {
  rm -f "$RUNNER_NEXT"
}
trap cleanup_runner_next EXIT
cat >"$RUNNER_NEXT" <<'SH'
@@OTTO_LEGACY_RUNNER_SCRIPT@@
SH
RUNNER_CHANGED=0
if [ ! -f "$RUNNER_FILE" ] || ! cmp -s "$RUNNER_NEXT" "$RUNNER_FILE"; then
  RUNNER_CHANGED=1
fi
mv "$RUNNER_NEXT" "$RUNNER_FILE"
chmod 700 "$RUNNER_FILE"
if ! ensure_remote_node_path; then
  printf 'Remote host is missing node on PATH. Install Node or configure a supported version manager for non-interactive shells.\\n' >&2
  exit 1
fi
pick_port() {
  node - "$PORT_FILE" "@@OTTO_LEGACY_DEFAULT_REMOTE_PORT@@" "@@OTTO_LEGACY_REMOTE_PORT_SCAN_WINDOW@@" <<'NODE'
@@OTTO_LEGACY_PICK_PORT_SCRIPT@@
NODE
}
wait_ready() {
  node - "$REMOTE_PORT" "$1" "@@OTTO_LEGACY_READY_PROBE_TIMEOUT_MS@@" <<'NODE'
@@OTTO_LEGACY_WAIT_READY_SCRIPT@@
NODE
}
wait_for_pid_exit() {
  PID_TO_WAIT="$1"
  WAIT_COUNT=0
  while kill -0 "$PID_TO_WAIT" 2>/dev/null && [ "$WAIT_COUNT" -lt 20 ]; do
    WAIT_COUNT=$((WAIT_COUNT + 1))
    sleep 0.1
  done
}
resolve_default_runtime_port() {
  node - "$DEFAULT_RUNTIME_FILE" <<'NODE'
const fs = require("node:fs");
const runtimePath = process.argv[2] ?? "";
try {
	  const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
	  const pid = Number(runtime.pid);
	  const port = Number(runtime.port);
	  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port)) {
	    process.exit(1);
	  }
  const origin = new URL(String(runtime.origin ?? ""));
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(origin.hostname)) {
    process.exit(1);
  }
  process.kill(pid, 0);
  process.stdout.write(\`\${pid} \${port}\`);
} catch {
  process.exit(1);
}
NODE
}
REMOTE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
REMOTE_PORT="$(cat "$PORT_FILE" 2>/dev/null || true)"
REMOTE_MANAGED="$(cat "$MANAGED_FILE" 2>/dev/null || true)"
DEFAULT_RUNTIME_INFO="$(resolve_default_runtime_port 2>/dev/null || true)"
DEFAULT_RUNTIME_PID=""
DEFAULT_REMOTE_PORT=""
if [ -n "$DEFAULT_RUNTIME_INFO" ]; then
  DEFAULT_RUNTIME_PID="\${DEFAULT_RUNTIME_INFO%% *}"
  DEFAULT_REMOTE_PORT="\${DEFAULT_RUNTIME_INFO#* }"
fi
if [ -n "$DEFAULT_REMOTE_PORT" ]; then
  REMOTE_PORT="$DEFAULT_REMOTE_PORT"
  if wait_ready "@@OTTO_LEGACY_REUSE_READY_TIMEOUT_MS@@"; then
    if [ "$REMOTE_MANAGED" = "managed" ]; then
      PID_TO_STOP="\${REMOTE_PID:-$DEFAULT_RUNTIME_PID}"
      if [ -n "$PID_TO_STOP" ] && kill -0 "$PID_TO_STOP" 2>/dev/null; then
        kill "$PID_TO_STOP" 2>/dev/null || true
        wait_for_pid_exit "$PID_TO_STOP"
      fi
      REMOTE_PID=""
      REMOTE_PORT="$DEFAULT_REMOTE_PORT"
      REMOTE_MANAGED="external"
      rm -f "$PID_FILE"
      printf '%s\\n' "$REMOTE_PORT" >"$PORT_FILE"
      printf 'external\\n' >"$MANAGED_FILE"
    else
      printf '%s\\n' "$REMOTE_PORT" >"$PORT_FILE"
      printf 'external\\n' >"$MANAGED_FILE"
      REMOTE_PID=""
      REMOTE_MANAGED="external"
    fi
  else
    REMOTE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    REMOTE_PORT="$(cat "$PORT_FILE" 2>/dev/null || true)"
    REMOTE_MANAGED="$(cat "$MANAGED_FILE" 2>/dev/null || true)"
  fi
fi
if [ "$REMOTE_MANAGED" = "external" ]; then
  if [ -z "$REMOTE_PORT" ] || ! wait_ready "@@OTTO_LEGACY_REUSE_READY_TIMEOUT_MS@@"; then
    REMOTE_PID=""
    REMOTE_PORT=""
    REMOTE_MANAGED=""
  fi
elif [ -n "$REMOTE_PID" ] && [ -n "$REMOTE_PORT" ] && kill -0 "$REMOTE_PID" 2>/dev/null; then
  if [ "$RUNNER_CHANGED" -eq 1 ]; then
    kill "$REMOTE_PID" 2>/dev/null || true
    wait_for_pid_exit "$REMOTE_PID"
    REMOTE_PID=""
    REMOTE_PORT=""
    REMOTE_MANAGED=""
  elif ! wait_ready "@@OTTO_LEGACY_REUSE_READY_TIMEOUT_MS@@"; then
    kill "$REMOTE_PID" 2>/dev/null || true
    wait_for_pid_exit "$REMOTE_PID"
    REMOTE_PID=""
    REMOTE_PORT=""
    REMOTE_MANAGED=""
  fi
else
  REMOTE_PID=""
  REMOTE_PORT=""
  REMOTE_MANAGED=""
fi
if [ -z "$REMOTE_PORT" ]; then
  REMOTE_PORT="$(pick_port)" || true
  if [ -z "$REMOTE_PORT" ]; then
    printf 'Failed to find an available port on the remote host. Ensure node is available on PATH.\\n' >&2
    exit 1
  fi
  nohup env OTTO_LEGACY_NO_BROWSER=1 "$RUNNER_FILE" serve --host 127.0.0.1 --port "$REMOTE_PORT" --base-dir "$DEFAULT_SERVER_HOME" >>"$LOG_FILE" 2>&1 < /dev/null &
  REMOTE_PID="$!"
  printf '%s\\n' "$REMOTE_PID" >"$PID_FILE"
  printf '%s\\n' "$REMOTE_PORT" >"$PORT_FILE"
  printf 'managed\\n' >"$MANAGED_FILE"
  if ! wait_ready "@@OTTO_LEGACY_READY_TIMEOUT_MS@@"; then
    printf 'Remote Otto server did not become ready on 127.0.0.1:%s.\\n' "$REMOTE_PORT" >&2
    if [ -s "$LOG_FILE" ]; then
      tail -n 80 "$LOG_FILE" >&2 2>/dev/null || true
    else
      printf 'It wrote nothing to %s, so it exited before producing any output.\\n' "$LOG_FILE" >&2
    fi
    kill "$REMOTE_PID" 2>/dev/null || true
    wait_for_pid_exit "$REMOTE_PID"
    rm -f "$PID_FILE" "$PORT_FILE" "$MANAGED_FILE"
    exit 1
  fi
fi
printf '{"remotePort":%s,"serverKind":"%s"}\\n' "$REMOTE_PORT" "\${REMOTE_MANAGED:-managed}"
`;

export const REMOTE_PAIRING_SCRIPT = `set -eu
STATE_DIR="$HOME/.ottoLegacy/ssh-launch/@@OTTO_LEGACY_STATE_KEY@@"
DEFAULT_SERVER_HOME="$HOME/.ottoLegacy"
RUNNER_FILE="$STATE_DIR/run-ottoLegacy.sh"
mkdir -p "$STATE_DIR"
cat >"$RUNNER_FILE" <<'SH'
@@OTTO_LEGACY_RUNNER_SCRIPT@@
SH
chmod 700 "$RUNNER_FILE"
PAIRING_BASE_DIR="$DEFAULT_SERVER_HOME"
"$RUNNER_FILE" auth pairing create --base-dir "$PAIRING_BASE_DIR" --json
`;

export const REMOTE_STOP_SCRIPT = `set -eu
STATE_DIR="$HOME/.ottoLegacy/ssh-launch/@@OTTO_LEGACY_STATE_KEY@@"
PID_FILE="$STATE_DIR/pid"
PORT_FILE="$STATE_DIR/port"
MANAGED_FILE="$STATE_DIR/managed"
REMOTE_MANAGED="$(cat "$MANAGED_FILE" 2>/dev/null || true)"
REMOTE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [ "$REMOTE_MANAGED" != "external" ] && [ -n "$REMOTE_PID" ] && kill -0 "$REMOTE_PID" 2>/dev/null; then
  kill "$REMOTE_PID" 2>/dev/null || true
  WAIT_COUNT=0
  while kill -0 "$REMOTE_PID" 2>/dev/null && [ "$WAIT_COUNT" -lt 20 ]; do
    WAIT_COUNT=$((WAIT_COUNT + 1))
    sleep 0.1
  done
  if kill -0 "$REMOTE_PID" 2>/dev/null; then
    printf 'Remote Otto server with PID %s did not stop within 2 seconds. Its ownership files were kept.\\n' "$REMOTE_PID" >&2
    exit 1
  fi
fi
rm -f "$PID_FILE" "$PORT_FILE" "$MANAGED_FILE"
printf '{"stopped":true}\\n'
`;

const REMOTE_LOG_TAIL_SCRIPT = `set -eu
STATE_DIR="$HOME/.ottoLegacy/ssh-launch/@@OTTO_LEGACY_STATE_KEY@@"
LOG_FILE="$STATE_DIR/server.log"
if [ -f "$LOG_FILE" ]; then
  tail -n 80 "$LOG_FILE" 2>/dev/null || true
fi
`;

export function buildRemoteOttoLegacyRunnerScript(input?: RemoteOttoLegacyRunnerOptions): string {
  const packageSpec = shellSingleQuote(input?.packageSpec?.trim() || "");
  const nodeScriptPath = input?.nodeScriptPath?.trim() || "";

  return stripTrailingNewlines(
    applyScriptPlaceholders(REMOTE_RUNNER_SCRIPT, {
      OTTO_LEGACY_PACKAGE_SPEC: packageSpec,
      OTTO_LEGACY_NODE_SCRIPT_PATH: shellSingleQuote(nodeScriptPath),
      OTTO_LEGACY_NODE_ENV_SCRIPT: buildRemoteNodeEnvScript(input),
    }),
  );
}

export function buildRemoteNodeEnvScript(input?: RemoteOttoLegacyRunnerOptions): string {
  return stripTrailingNewlines(
    applyScriptPlaceholders(REMOTE_NODE_ENV_SCRIPT, {
      OTTO_LEGACY_NODE_ENGINE_RANGE: shellSingleQuote(input?.nodeEngineRange?.trim() || ""),
      OTTO_LEGACY_NODE_ENGINE_CHECK_SCRIPT: stripTrailingNewlines(
        buildRemoteNodeEngineCheckScript(),
      ),
    }),
  );
}

export function buildRemoteLaunchScript(input?: RemoteOttoLegacyRunnerOptions): string {
  return applyScriptPlaceholders(REMOTE_LAUNCH_SCRIPT, {
    OTTO_LEGACY_NODE_ENV_SCRIPT: buildRemoteNodeEnvScript(input),
    OTTO_LEGACY_RUNNER_SCRIPT: stripTrailingNewlines(buildRemoteOttoLegacyRunnerScript(input)),
    OTTO_LEGACY_PICK_PORT_SCRIPT: stripTrailingNewlines(REMOTE_PICK_PORT_SCRIPT),
    OTTO_LEGACY_WAIT_READY_SCRIPT: stripTrailingNewlines(REMOTE_WAIT_READY_SCRIPT),
    OTTO_LEGACY_DEFAULT_REMOTE_PORT: String(DEFAULT_REMOTE_PORT),
    OTTO_LEGACY_REMOTE_PORT_SCAN_WINDOW: String(REMOTE_PORT_SCAN_WINDOW),
    OTTO_LEGACY_READY_TIMEOUT_MS: String(REMOTE_READY_TIMEOUT_MS),
    OTTO_LEGACY_REUSE_READY_TIMEOUT_MS: String(REMOTE_REUSE_READY_TIMEOUT_MS),
    OTTO_LEGACY_READY_PROBE_TIMEOUT_MS: String(SSH_READY_PROBE_TIMEOUT_MS),
  });
}

export function buildRemotePairingScript(
  target: DesktopSshEnvironmentTarget,
  input?: RemoteOttoLegacyRunnerOptions,
): string {
  return applyScriptPlaceholders(REMOTE_PAIRING_SCRIPT, {
    OTTO_LEGACY_STATE_KEY: remoteStateKey(target),
    OTTO_LEGACY_RUNNER_SCRIPT: stripTrailingNewlines(buildRemoteOttoLegacyRunnerScript(input)),
  });
}

export function buildRemoteStopScript(target: DesktopSshEnvironmentTarget): string {
  return applyScriptPlaceholders(REMOTE_STOP_SCRIPT, {
    OTTO_LEGACY_STATE_KEY: remoteStateKey(target),
  });
}

export function buildRemoteLogTailScript(target: DesktopSshEnvironmentTarget): string {
  return applyScriptPlaceholders(REMOTE_LOG_TAIL_SCRIPT, {
    OTTO_LEGACY_STATE_KEY: remoteStateKey(target),
  });
}
