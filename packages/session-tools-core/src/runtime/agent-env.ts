/**
 * The one place that builds the environment of everything an agent can run:
 * the Claude and Pi subprocesses (and so their shell tools), script tools,
 * automation scripts and MCP stdio servers.
 *
 * The server's own environment holds secrets (ENCRYPTION_KEY decrypts the
 * secrets table, BETTER_AUTH_SECRET forges sessions, OTTO_SERVER_TOKEN is the
 * machine credential), so a child never inherits `process.env`. It gets an
 * allow-list of host variables (paths, locale, proxy and CA settings, toolchain
 * locations) plus what the caller passes on purpose (the connection's auth,
 * per-session paths). The server's own secrets are refused even when passed.
 */

/** Host variables that pass through, compared upper-cased (Windows names are case-insensitive). */
const HOST_ALLOW = new Set([
  // Identity, shell and locale
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LANGUAGE', 'TERM', 'TZ', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR',
  'TMPDIR', 'TEMP', 'TMP', 'EDITOR', 'VISUAL', 'DISPLAY', 'WAYLAND_DISPLAY',
  // Network: proxies and CA bundles (both cases are matched by the upper-casing)
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  // git over ssh keeps working through the user's agent socket
  'SSH_AUTH_SOCK',
  // Where the user's toolchains live (paths only, so node, uv, cargo, go... still resolve)
  'BUN_INSTALL', 'NVM_DIR', 'VOLTA_HOME', 'PNPM_HOME', 'PYENV_ROOT', 'ASDF_DIR', 'ASDF_DATA_DIR',
  'CARGO_HOME', 'RUSTUP_HOME', 'GOPATH', 'GOROOT', 'JAVA_HOME',
  // Windows basics
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE',
  'USERNAME', 'USERDOMAIN', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMDATA', 'ALLUSERSPROFILE', 'PUBLIC', 'OS',
  'COMPUTERNAME', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS',
  // Runtime hints the app sets for its agents (never credentials)
  'OTTO_CONFIG_DIR', 'OTTO_DEBUG', 'OTTO_IS_PACKAGED', 'OTTO_RESOURCES_BASE', 'OTTO_APP_ROOT', 'OTTO_VERSION',
  'OTTO_UV', 'OTTO_NODE', 'OTTO_BUN', 'OTTO_SCRIPTS', 'OTTO_COMMANDS_ENTRY', 'OTTO_CLI_ENTRY',
  'OTTO_COMMANDS_DOC_PATH', 'OTTO_CLI_DOC_PATH', 'OTTO_DEV_RUNTIME', 'OTTO_VIEWER_URL', 'OTTO_LLM_CALLBACK_PORT',
  'OTTO_INTERCEPTOR_DISABLE_AUTO_INSTALL', 'OTTO_DEBUG_FULL_BODIES', 'OTTO_DEBUG_SSE_RAW',
]);

const HOST_ALLOW_PREFIX = ['LC_', 'XDG_', 'GIT_', 'PROGRAMFILES', 'COMMONPROGRAMFILES', 'OTTO_FEATURE_'];

/** The server's own secrets: refused even when a caller passes them. */
const DENY = /^(ENCRYPTION_KEY|BETTER_AUTH_.*|OTTO_SERVER_TOKEN|OTTO_WEBUI_.*|OTTO_OWNER_EMAIL|OTTO_RPC_.*|INFISICAL_.*)$/;

export function isServerSecretEnvKey(key: string): boolean {
  return DENY.test(key.toUpperCase());
}

function isHostAllowed(key: string): boolean {
  const upper = key.toUpperCase();
  return HOST_ALLOW.has(upper) || HOST_ALLOW_PREFIX.some((p) => upper.startsWith(p));
}

/**
 * Environment for an agent subprocess or tool.
 *
 * @param extra Passed on purpose and kept (the connection's API key or OAuth
 *   token, session paths, a source's own env), except the server's secrets.
 *   `undefined` values are skipped; an empty string is kept (it clears a variable).
 * @param host The environment to filter; the server's `process.env` by default.
 */
export function agentEnv(
  extra?: Record<string, string | undefined>,
  host: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const win = process.platform === 'win32';
  // One entry per variable; on Windows "Path" and "PATH" are the same variable.
  const out = new Map<string, [string, string]>();
  const put = (key: string, value: string | undefined) => {
    if (value !== undefined) out.set(win ? key.toUpperCase() : key, [key, value]);
  };
  for (const [key, value] of Object.entries(host)) {
    if (isHostAllowed(key) && !isServerSecretEnvKey(key)) put(key, value);
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (!isServerSecretEnvKey(key)) put(key, value);
  }
  return Object.fromEntries(out.values());
}

/** The host variables matching `pattern` (a connection that authenticates through the host environment). */
export function hostEnvMatching(
  pattern: RegExp,
  host: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [key, value] of Object.entries(host)) {
    if (value !== undefined && pattern.test(key)) picked[key] = value;
  }
  return picked;
}
