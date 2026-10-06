import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { getCredentialManager } from '../credentials/index.ts';
import {
  discoverWorkspacesInDefaultLocation,
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  createWorkspaceAtPath,
  isValidWorkspace,
} from '../workspaces/storage.ts';
import { updateWorkspaceMirror } from '../workspaces/members.ts';
import { initSecretsStore } from '../secrets/index.ts';
import { INSTALL, getSetting, getUserSetting, updateSetting, updateUserSetting } from '../settings/index.ts';
import { findIconFile } from '../utils/icon.ts';
import { extractWorkspaceSlugFromPath } from '../utils/workspace-slug.ts';
import { initializeDocs } from '../docs/index.ts';
import { expandPath, toPortablePath, getBundledAssetsDir } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';
import { readJsonFileSync } from '../utils/files.ts';
import { CONFIG_DIR } from './paths.ts';
import type { StoredMessage } from '@otto/core/types';
import type { Plan } from '../agent/plan-types.ts';
import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';
import { parsePermissionMode, DEFAULT_PERMISSION_MODES } from '../agent/mode-types.ts';
import { type ConfigDefaults } from './config-defaults-schema.ts';
import { isValidThemeFile } from './validators.ts';
import {
  mergeDecisionLayerSettings,
  normalizeDecisionLayerSettings,
  type DecisionLayerSettings,
  type DecisionLayerStoredSettings,
} from '../decisions/settings.ts';
import type { ServerConfig } from './server-config.ts';
import { randomUUID } from 'crypto';

// Re-export CONFIG_DIR for convenience (centralized in paths.ts)
export { CONFIG_DIR } from './paths.ts';

// Re-export base types from core (single source of truth)
export type {
  WorkspaceInfo,
  Workspace,
  McpAuthType,
  AuthType,
  OAuthCredentials,
} from '@otto/core/types';

// Import for local use
import type { Workspace } from '@otto/core/types';

// LLM connections live in the connections domain; this file keeps wrappers with the old names
import type { LlmConnection } from './llm-connections.ts';
import {
  INSTALL_SCOPE,
  createConnection,
  deleteConnection,
  getConnection,
  getConnections,
  getDefaultConnection,
  setDefaultConnection,
  updateConnection,
  type Connection,
  type ConnectionContext,
  type ConnectionInput,
  type ConnectionPatch,
  type Credential,
} from '../connections/index.ts';

// Config stored in JSON file (credentials stored in encrypted file, not here).
// What a person or the install configures lives in `settings` (../settings); the keys the importer moved
// there are still in an old file but nothing reads them, and a save keeps them as they are.
export interface StoredConfig {
  workspaces: Workspace[];
  // One-shot migration markers. Used by migrations that should run at most
  // once per user (e.g. restoring a previously-removed model to connection
  // lists without re-adding it if the user later removes it deliberately).
  migrationsApplied?: string[];
}

const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const CONFIG_DEFAULTS_FILE = join(CONFIG_DIR, 'config-defaults.json');

// Track if config-defaults have been synced this session (prevents re-sync on hot reload)
let configDefaultsSynced = false;

/**
 * Sync config-defaults.json from bundled assets.
 * Always writes on launch to ensure defaults are up-to-date with the running version.
 * Follows the same pattern as docs, themes, and other bundled assets.
 *
 * Source of truth: apps/electron/resources/config-defaults.json
 */
/** Minimal config-defaults used when bundled assets aren't available (CI, standalone server). */
const FALLBACK_CONFIG_DEFAULTS: ConfigDefaults = {
  version: '1.0',
  description: 'Default configuration values for Otto',
  workspaceDefaults: {
    thinkingLevel: 'medium',
    permissionMode: 'ask',
    cyclablePermissionModes: ['safe', 'ask', 'allow-all'],
    localMcpServers: { enabled: true },
  },
};

function syncConfigDefaults(): void {
  if (configDefaultsSynced) return;
  configDefaultsSynced = true;

  // Get bundled config-defaults.json from resources folder
  const bundledDir = getBundledAssetsDir('.');
  if (!bundledDir) {
    debug('[config] No bundled assets dir found - using fallback config-defaults');
    if (!existsSync(CONFIG_DEFAULTS_FILE)) {
      writeFileSync(CONFIG_DEFAULTS_FILE, JSON.stringify(FALLBACK_CONFIG_DEFAULTS, null, 2), 'utf-8');
    }
    return;
  }

  const bundledFile = join(bundledDir, 'config-defaults.json');
  if (!existsSync(bundledFile)) {
    debug('[config] Bundled config-defaults.json not found at: ' + bundledFile + ' - using fallback');
    if (!existsSync(CONFIG_DEFAULTS_FILE)) {
      writeFileSync(CONFIG_DEFAULTS_FILE, JSON.stringify(FALLBACK_CONFIG_DEFAULTS, null, 2), 'utf-8');
    }
    return;
  }

  // Sync from bundled file (same pattern as docs)
  const content = readFileSync(bundledFile, 'utf-8');
  writeFileSync(CONFIG_DEFAULTS_FILE, content, 'utf-8');
  debug('[config] Synced config-defaults.json from bundled assets');
}

/**
 * Load config defaults from ~/.otto/config-defaults.json
 * This file is synced from bundled assets on every launch.
 */
export function loadConfigDefaults(): ConfigDefaults {
  if (!existsSync(CONFIG_DEFAULTS_FILE)) {
    throw new Error('config-defaults.json not found at ' + CONFIG_DEFAULTS_FILE + '. Ensure ensureConfigDir() was called at startup.');
  }

  const defaults = readJsonFileSync<ConfigDefaults>(CONFIG_DEFAULTS_FILE);

  const parsedPermissionMode =
    typeof defaults.workspaceDefaults?.permissionMode === 'string'
      ? parsePermissionMode(defaults.workspaceDefaults.permissionMode)
      : null;
  defaults.workspaceDefaults.permissionMode = parsedPermissionMode ?? 'ask';

  const rawCyclable = Array.isArray(defaults.workspaceDefaults?.cyclablePermissionModes)
    ? defaults.workspaceDefaults.cyclablePermissionModes
    : [];

  const normalizedCyclable: PermissionMode[] = [];
  for (const mode of rawCyclable) {
    if (typeof mode !== 'string') continue;
    const parsed = parsePermissionMode(mode);
    if (!parsed) continue;
    if (!normalizedCyclable.includes(parsed)) {
      normalizedCyclable.push(parsed);
    }
  }

  defaults.workspaceDefaults.cyclablePermissionModes =
    normalizedCyclable.length >= 2 ? normalizedCyclable : [...DEFAULT_PERMISSION_MODES];

  return defaults;
}

/**
 * Ensure config-defaults.json exists and is up-to-date.
 * Syncs from bundled assets on every launch (like docs, themes, permissions).
 */
export function ensureConfigDefaults(): void {
  syncConfigDefaults();
}

let configDirInitialized = false;

const MAX_CONFIG_BACKUPS = 3;
const CONFIG_BACKUP_DATE_RE = /^config\.json\.bak-\d{4}-\d{2}-\d{2}$/;

/**
 * Snapshot an existing config.json into a dated file (config.json.bak-YYYY-MM-DD)
 * and keep only the newest MAX_CONFIG_BACKUPS. Runs once at startup, before any
 * path can mutate or (in failure paths) overwrite the workspace registry.
 * Best-effort: failures are logged and swallowed so a backup never blocks startup.
 */
export function backupConfigFile(): void {
  try {
    if (!existsSync(CONFIG_FILE)) return;

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dated = join(CONFIG_DIR, `config.json.bak-${stamp}`);
    // One backup per day, never overwritten: the first snapshot of the day is taken
    // before any mutation, so it holds the good pre-reset state. A second startup that
    // day (e.g. after a reset already nuked the registry) must NOT clobber it.
    if (existsSync(dated)) return;
    writeFileSync(dated, readFileSync(CONFIG_FILE, 'utf-8'), 'utf-8');

    // ISO date in the name → lexical sort is chronological; drop all but the newest few.
    const backups = readdirSync(CONFIG_DIR).filter(f => CONFIG_BACKUP_DATE_RE.test(f)).sort();
    for (const stale of backups.slice(0, Math.max(0, backups.length - MAX_CONFIG_BACKUPS))) {
      try { rmSync(join(CONFIG_DIR, stale)); } catch { /* ignore individual cleanup errors */ }
    }
  } catch (error) {
    debug('[config] backupConfigFile failed:', error instanceof Error ? error.message : error);
  }
}

export function ensureConfigDir(): void {
  if (configDirInitialized) return;

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Snapshot an existing config.json (dated, keep last 3) before anything can
  // mutate or — in a failure path — overwrite the workspace registry.
  backupConfigFile();
  // Initialize bundled docs (creates ~/.otto/docs/ with sources.md, agents.md, permissions.md)
  initializeDocs();

  // Initialize config defaults
  ensureConfigDefaults();

  // Initialize tool icons (CLI tool icons for turn card display)
  ensureToolIcons();

  configDirInitialized = true;
}

export function loadStoredConfig(): StoredConfig | null {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return null;
    }
    const config = readJsonFileSync<StoredConfig>(CONFIG_FILE);

    // Must have workspaces array
    if (!Array.isArray(config.workspaces)) {
      return null;
    }

    // Expand path variables (~ and ${HOME}) for portability
    for (const workspace of config.workspaces) {
      workspace.rootPath = expandPath(workspace.rootPath);
      readRemoteToken(workspace);
    }

    // Ensure workspace folder structure exists for all workspaces.
    // Failures here are non-fatal — the workspace will be re-created on next access.
    for (const workspace of config.workspaces) {
      if (!isValidWorkspace(workspace.rootPath)) {
        try {
          createWorkspaceAtPath(workspace.rootPath, workspace.name);
        } catch (wsError) {
          debug('[config] Failed to create workspace at', workspace.rootPath, ':', wsError instanceof Error ? wsError.message : wsError);
        }
      }
    }

    return config;
  } catch (error) {
    debug('[config] loadStoredConfig failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

// Legacy credential helpers removed - use connection-aware credential lookup instead:
// - getAnthropicApiKey() → credentialManager.getLlmApiKey(connectionSlug)
// - getClaudeOAuthToken() → credentialManager.getLlmOAuth(connectionSlug)

/** A remote workspace's token is a secret: the registry keeps `tokenSecretId`, and a read puts the token back in memory. */
function readRemoteToken(workspace: Workspace): void {
  const remote = workspace.remoteServer;
  if (!remote?.tokenSecretId) return;
  try {
    remote.token = initSecretsStore().getSecret(remote.tokenSecretId) ?? '';
  } catch (error) {
    debug('[config] could not read the remote token of', workspace.id, error instanceof Error ? error.message : error);
    remote.token = '';
  }
}

/**
 * Moves the tokens of remote workspaces into `secrets` (a changed one replaces its secret in place, one that
 * had none gets one, one of a workspace that is gone is deleted) and returns the registry entries without them.
 */
function storeRemoteTokens(workspaces: Workspace[]): Workspace[] {
  let previous = new Map<string, string>();
  try {
    const old = readJsonFileSync<StoredConfig>(CONFIG_FILE);
    previous = new Map(old.workspaces.flatMap((ws): [string, string][] => (ws.remoteServer?.tokenSecretId ? [[ws.id, ws.remoteServer.tokenSecretId]] : [])));
  } catch {
    // no registry yet
  }
  if (previous.size === 0 && !workspaces.some(ws => ws.remoteServer)) return workspaces;
  const secrets = initSecretsStore();
  const kept = new Set<string>();
  const stored = workspaces.map((ws): Workspace => {
    if (!ws.remoteServer) return ws;
    const { token, tokenSecretId, ...remote } = ws.remoteServer;
    let id = tokenSecretId ?? previous.get(ws.id);
    if (token) {
      if (id && secrets.getSecret(id) !== undefined) secrets.updateSecret(id, token);
      else id = secrets.createSecret(`Remote server token (${ws.name})`, token);
    }
    if (id) kept.add(id);
    return { ...ws, remoteServer: { ...remote, ...(id ? { tokenSecretId: id } : {}) } as Workspace['remoteServer'] };
  });
  for (const id of previous.values()) if (!kept.has(id)) secrets.deleteSecret(id);
  return stored;
}

export function saveConfig(config: StoredConfig): void {
  ensureConfigDir();

  // Convert paths to portable form (~ prefix) for cross-machine compatibility
  const storageConfig: StoredConfig = {
    ...config,
    workspaces: storeRemoteTokens(config.workspaces).map(ws => ({
      ...ws,
      rootPath: toPortablePath(ws.rootPath),
    })),
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(storageConfig, null, 2), 'utf-8');
}

// Legacy updateApiKey() removed - use setupLlmConnection IPC handler instead.

// Legacy getters/setters removed - use LLM connections instead:
// - getAuthType/setAuthType -> derive from getDefaultLlmConnection()/getLlmConnection()
// - getAnthropicBaseUrl/setAnthropicBaseUrl -> use connection.baseUrl
// - getCustomModel/setCustomModel -> use connection.defaultModel


// What a person has set (their own, `user:<id>` settings; with no `userId` the first user's, the local user on a desktop)

/** Whether desktop notifications are enabled (default: true). */
export const getNotificationsEnabled = (userId?: string | null): boolean => getUserSetting(userId, 'notificationsEnabled');
export const setNotificationsEnabled = (enabled: boolean, userId?: string | null): void => void updateUserSetting(userId, 'notificationsEnabled', enabled);

/** Whether the input capitalises the first letter (default: true). */
export const getAutoCapitalisation = (userId?: string | null): boolean => getUserSetting(userId, 'autoCapitalisation');
export const setAutoCapitalisation = (enabled: boolean, userId?: string | null): void => void updateUserSetting(userId, 'autoCapitalisation', enabled);

/** The key combination that sends a message (default: 'enter'). */
export const getSendMessageKey = (userId?: string | null): 'enter' | 'cmd-enter' => getUserSetting(userId, 'sendMessageKey');
export const setSendMessageKey = (key: 'enter' | 'cmd-enter', userId?: string | null): void => void updateUserSetting(userId, 'sendMessageKey', key);

/** Whether the input checks spelling (default: false). */
export const getSpellCheck = (userId?: string | null): boolean => getUserSetting(userId, 'spellCheck');
export const setSpellCheck = (enabled: boolean, userId?: string | null): void => void updateUserSetting(userId, 'spellCheck', enabled);

/** Whether tool calls carry intent and display-name metadata (default: true). */
export const getRichToolDescriptions = (userId?: string | null): boolean => getUserSetting(userId, 'richToolDescriptions');
export const setRichToolDescriptions = (enabled: boolean, userId?: string | null): void => void updateUserSetting(userId, 'richToolDescriptions', enabled);

/** The selected color theme id (default: 'default'). */
export const getColorTheme = (userId?: string | null): string => getUserSetting(userId, 'colorTheme');
export const setColorTheme = (themeId: string, userId?: string | null): void => void updateUserSetting(userId, 'colorTheme', themeId);

// What the whole install has set (`install` settings)

/** Whether the screen stays awake while chats run (default: false). */
export const getKeepAwakeWhileRunning = (): boolean => getSetting(INSTALL, 'keepAwakeWhileRunning');
export const setKeepAwakeWhileRunning = (enabled: boolean): void => void updateSetting(INSTALL, 'keepAwakeWhileRunning', enabled);

/**
 * Whether remote agents may call `browser_tool evaluate <expression>` against this
 * desktop client's local browser. The check is enforced inside the local capability
 * dispatcher; the remote server cannot override it. Defaults to true.
 */
export const getAllowRemoteEvaluate = (): boolean => getSetting(INSTALL, 'allowRemoteEvaluate');

/**
 * Decision layer (Jev / TypeSafe System One) settings with defaults applied.
 * Off by default; the `enabled` switch is the only master gate.
 * See `src/decisions/settings.ts` for the shape and `src/decisions/resolve.ts` for how it is used.
 */
export function getDecisionLayerSettings(): DecisionLayerSettings {
  return normalizeDecisionLayerSettings(getSetting(INSTALL, 'decisionLayer'));
}

/**
 * Merge a settings patch (features merge key-wise; `null` clears an optional
 * string) and persist. Returns the normalized result.
 */
export function setDecisionLayerSettings(patch: Partial<Record<keyof DecisionLayerStoredSettings, unknown>>): DecisionLayerSettings {
  return normalizeDecisionLayerSettings(updateSetting(INSTALL, 'decisionLayer', mergeDecisionLayerSettings(getSetting(INSTALL, 'decisionLayer'), patch)));
}

/** The persisted Git Bash path (Windows only), used to set CLAUDE_CODE_GIT_BASH_PATH for the SDK subprocess. */
export const getGitBashPath = (): string | undefined => getSetting(INSTALL, 'gitBashPath') ?? undefined;

/** Persists the Git Bash path (Windows only) so it survives restarts. */
export function setGitBashPath(path: string): boolean {
  updateSetting(INSTALL, 'gitBashPath', path);
  return true;
}

/** Forgets the persisted Git Bash path (it is stale or invalid). */
export const clearGitBashPath = (): void => void updateSetting(INSTALL, 'gitBashPath', null);

/** The update version the user dismissed (its banner stays away), or null. */
export const getDismissedUpdateVersion = (): string | null => getSetting(INSTALL, 'dismissedUpdateVersion');
export const setDismissedUpdateVersion = (version: string): void => void updateSetting(INSTALL, 'dismissedUpdateVersion', version);
/** Call this when a new version is released (or on successful update). */
export const clearDismissedUpdateVersion = (): void => void updateSetting(INSTALL, 'dismissedUpdateVersion', null);

// Note: getDefaultWorkingDirectory/setDefaultWorkingDirectory removed
// Working directory is now stored per-workspace in workspace config.json (defaults.workingDirectory)
// Note: getDefaultPermissionMode/getEnabledPermissionModes removed
// Permission settings are now stored per-workspace in workspace config.json (defaults.permissionMode, defaults.cyclablePermissionModes)

export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Clear all configuration and credentials (for logout).
 * Deletes config file and credentials file.
 */
export async function clearAllConfig(): Promise<void> {
  // Delete config file
  if (existsSync(CONFIG_FILE)) {
    rmSync(CONFIG_FILE);
  }

  // Delete credentials file
  const credentialsFile = join(CONFIG_DIR, 'credentials.enc');
  if (existsSync(credentialsFile)) {
    rmSync(credentialsFile);
  }

  // Optionally: Delete workspace data (conversations)
  const workspacesDir = join(CONFIG_DIR, 'workspaces');
  if (existsSync(workspacesDir)) {
    rmSync(workspacesDir, { recursive: true });
  }
}

// ============================================
// Workspace Management Functions
// ============================================

/**
 * Generate a unique workspace ID.
 * Uses a random UUID-like format.
 */
export function generateWorkspaceId(): string {
  // Generate random bytes and format as UUID-like string (8-4-4-4-12)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Find workspace icon file at workspace_root/icon.*
 * Returns absolute path to icon file if found, null otherwise
 */
export function findWorkspaceIcon(rootPath: string): string | null {
  return findIconFile(rootPath) ?? null;
}

export function getWorkspaces(): Workspace[] {
  const config = loadStoredConfig();
  const workspaces = config?.workspaces || [];

  // Resolve workspace names from folder config and local icons
  return workspaces.map(w => {
    // Read name from workspace folder config (single source of truth)
    const wsConfig = loadWorkspaceConfig(w.rootPath);
    const name = wsConfig?.name || basename(w.rootPath) || 'Untitled';

    // If workspace has a stored iconUrl that's a remote URL, use it
    // Otherwise check for local icon file
    let iconUrl = w.iconUrl;
    if (!iconUrl || (!iconUrl.startsWith('http://') && !iconUrl.startsWith('https://'))) {
      const localIcon = findWorkspaceIcon(w.rootPath);
      if (localIcon) {
        // Convert absolute path to file:// URL for Electron renderer
        // Append mtime as cache-buster so UI refreshes when icon changes
        try {
          const mtime = statSync(localIcon).mtimeMs;
          iconUrl = `file://${localIcon}?t=${mtime}`;
        } catch {
          iconUrl = `file://${localIcon}`;
        }
      }
    }

    const slug = extractWorkspaceSlugFromPath(w.rootPath, w.id);
    return { ...w, name, slug, iconUrl };
  });
}

/**
 * Copies the registry into the `workspaces` table (workspaces/members.ts), where members and
 * invitations point at it. Runs at boot and whenever a workspace is added, removed or renamed.
 */
export function refreshWorkspaceMirror(): void {
  updateWorkspaceMirror(getWorkspaces().map((workspace) => ({ id: workspace.id, title: workspace.name })));
}

/** The workspace this user last made active (the first user's without a `userId`), else the first workspace. */
export function getActiveWorkspace(userId?: string | null): Workspace | null {
  const config = loadStoredConfig();
  if (!config) return null;
  const activeId = getUserSetting(userId, 'activeWorkspaceId');
  return config.workspaces.find(w => w.id === activeId) || config.workspaces[0] || null;
}

/**
 * Find a workspace by name (case-insensitive) or ID.
 * Useful for CLI -w flag to specify workspace.
 */
export function getWorkspaceByNameOrId(nameOrId: string): Workspace | null {
  const workspaces = getWorkspaces();
  return workspaces.find(w =>
    w.id === nameOrId ||
    w.name.toLowerCase() === nameOrId.toLowerCase()
  ) || null;
}

let workspaceIndex: { stamp: string; roots: Map<string, string> } | undefined;

/** Registered workspaces as root path -> id, rebuilt when config.json changes (its mtime and size), so a per-chat lookup does not parse the file. */
function getWorkspaceRoots(): Map<string, string> {
  let stamp = 'none';
  try {
    const stat = statSync(CONFIG_FILE);
    stamp = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    // no config yet: no workspaces
  }
  if (workspaceIndex?.stamp !== stamp) {
    workspaceIndex = { stamp, roots: new Map((loadStoredConfig()?.workspaces ?? []).map(w => [w.rootPath, w.id])) };
  }
  return workspaceIndex.roots;
}

/** The id of the workspace whose root is this path; null when none is registered there. */
export function getWorkspaceIdByRootPath(rootPath: string): string | null {
  return getWorkspaceRoots().get(rootPath) ?? null;
}

/** The root path of a registered workspace; null for an unknown id. */
export function getWorkspaceRootPath(workspaceId: string): string | null {
  for (const [rootPath, id] of getWorkspaceRoots()) if (id === workspaceId) return rootPath;
  return null;
}

export function updateWorkspaceRemoteServer(
  workspaceId: string,
  remoteServer: { url: string; token: string; remoteWorkspaceId: string },
): void {
  const config = loadStoredConfig();
  if (!config) return;
  const ws = config.workspaces.find(w => w.id === workspaceId);
  if (!ws) throw new Error('Workspace not found');
  ws.remoteServer = remoteServer;
  saveConfig(config);
}

export function setActiveWorkspace(workspaceId: string, userId?: string | null): void {
  if (!loadStoredConfig()?.workspaces.some(w => w.id === workspaceId)) return;
  updateUserSetting(userId, 'activeWorkspaceId', workspaceId);
}

/**
 * Add a workspace to the global config.
 * @param workspace - Workspace data (must include rootPath)
 */
export function addWorkspace(workspace: Omit<Workspace, 'id' | 'createdAt' | 'slug'>): Workspace {
  const config = loadStoredConfig();
  if (!config) {
    throw new Error('No config found');
  }

  const slug = extractWorkspaceSlugFromPath(workspace.rootPath, '');

  // Check if workspace with same rootPath already exists
  const existing = config.workspaces.find(w => w.rootPath === workspace.rootPath);
  if (existing) {
    // Update existing workspace with new settings
    const updated: Workspace = {
      ...existing,
      ...workspace,
      slug,
      id: existing.id,
      createdAt: existing.createdAt,
    };
    const existingIndex = config.workspaces.indexOf(existing);
    config.workspaces[existingIndex] = updated;
    saveConfig(config);
    refreshWorkspaceMirror();
    return updated;
  }

  const newWorkspace: Workspace = {
    ...workspace,
    slug,
    id: generateWorkspaceId(),
    createdAt: Date.now(),
  };

  // Create workspace folder structure if it doesn't exist
  if (!isValidWorkspace(newWorkspace.rootPath)) {
    createWorkspaceAtPath(newWorkspace.rootPath, newWorkspace.name);
  }

  config.workspaces.push(newWorkspace);

  saveConfig(config);
  refreshWorkspaceMirror();
  return newWorkspace;
}

/**
 * Sync workspaces by discovering workspaces in the default location
 * that aren't already tracked in the global config.
 * Call this on app startup.
 */
export function syncWorkspaces(): void {
  const config = loadStoredConfig();
  if (!config) return;

  const discoveredPaths = discoverWorkspacesInDefaultLocation();
  const trackedPaths = new Set(config.workspaces.map(w => w.rootPath));

  let added = false;
  for (const rootPath of discoveredPaths) {
    if (trackedPaths.has(rootPath)) continue;

    // Load the workspace config to get name
    const wsConfig = loadWorkspaceConfig(rootPath);
    if (!wsConfig) continue;

    const newWorkspace: Workspace = {
      id: wsConfig.id || generateWorkspaceId(),
      name: wsConfig.name,
      slug: extractWorkspaceSlugFromPath(rootPath, ''),
      rootPath,
      createdAt: wsConfig.createdAt || Date.now(),
    };

    config.workspaces.push(newWorkspace);
    added = true;
  }

  if (added) {
    saveConfig(config);
    refreshWorkspaceMirror();
  }
}

export async function removeWorkspace(workspaceId: string): Promise<boolean> {
  const config = loadStoredConfig();
  if (!config) return false;

  const index = config.workspaces.findIndex(w => w.id === workspaceId);
  if (index === -1) return false;

  config.workspaces.splice(index, 1);

  saveConfig(config);
  refreshWorkspaceMirror();

  // Clean up credential store credentials for this workspace
  const manager = getCredentialManager();
  await manager.deleteWorkspaceCredentials(workspaceId);

  // Delete workspace data directory (sessions, plans, etc.)
  const workspaceDataDir = join(WORKSPACES_DIR, workspaceId);
  if (existsSync(workspaceDataDir)) {
    try {
      rmSync(workspaceDataDir, { recursive: true });
    } catch (error) {
      console.error(`[storage] Failed to delete workspace data directory: ${workspaceDataDir}`, error);
    }
  }

  return true;
}

// Note: renameWorkspace() was removed - workspace names are now stored only in folder config
// Use updateWorkspaceSetting('name', ...) to rename workspaces via the folder config

// ============================================
// Workspace Conversation Persistence
// ============================================

const WORKSPACES_DIR = join(CONFIG_DIR, 'workspaces');

function ensureWorkspaceDir(workspaceId: string): string {
  const dir = join(WORKSPACES_DIR, workspaceId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}


// Re-export types from core for convenience
export type { StoredAttachment, StoredMessage } from '@otto/core/types';

export interface WorkspaceConversation {
  messages: StoredMessage[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    contextTokens: number;
    costUsd: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  savedAt: number;
}

// Save workspace conversation (messages + token usage)
export function saveWorkspaceConversation(
  workspaceId: string,
  messages: StoredMessage[],
  tokenUsage: WorkspaceConversation['tokenUsage']
): void {
  const dir = ensureWorkspaceDir(workspaceId);
  const filePath = join(dir, 'conversation.json');

  const conversation: WorkspaceConversation = {
    messages,
    tokenUsage,
    savedAt: Date.now(),
  };

  try {
    writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf-8');
  } catch (e) {
    // Handle cyclic structures or other serialization errors
    console.error(`[storage] [CYCLIC STRUCTURE] Failed to save workspace conversation:`, e);
    console.error(`[storage] Message count: ${messages.length}, message types: ${messages.map(m => m.type).join(', ')}`);
    // Try to save with sanitized messages
    try {
      const sanitizedMessages = messages.map((m, i) => {
        let safeToolInput = m.toolInput;
        if (m.toolInput) {
          try {
            JSON.stringify(m.toolInput);
          } catch (inputErr) {
            console.error(`[storage] [CYCLIC STRUCTURE] in message ${i} toolInput (tool: ${m.toolName}), keys: ${Object.keys(m.toolInput).join(', ')}, error: ${inputErr}`);
            safeToolInput = { error: '[non-serializable input]' };
          }
        }
        return { ...m, toolInput: safeToolInput };
      });
      const sanitizedConversation: WorkspaceConversation = {
        messages: sanitizedMessages,
        tokenUsage,
        savedAt: Date.now(),
      };
      writeFileSync(filePath, JSON.stringify(sanitizedConversation, null, 2), 'utf-8');
      console.error(`[storage] Saved sanitized workspace conversation successfully`);
    } catch (e2) {
      console.error(`[storage] Failed to save even sanitized workspace conversation:`, e2);
    }
  }
}

// Load workspace conversation
export function loadWorkspaceConversation(workspaceId: string): WorkspaceConversation | null {
  const filePath = join(WORKSPACES_DIR, workspaceId, 'conversation.json');

  try {
    if (!existsSync(filePath)) {
      return null;
    }
    return readJsonFileSync<WorkspaceConversation>(filePath);
  } catch {
    return null;
  }
}

// Get workspace data directory path
export function getWorkspaceDataPath(workspaceId: string): string {
  return join(WORKSPACES_DIR, workspaceId);
}

// Clear workspace conversation
export function clearWorkspaceConversation(workspaceId: string): void {
  const filePath = join(WORKSPACES_DIR, workspaceId, 'conversation.json');
  if (existsSync(filePath)) {
    writeFileSync(filePath, '{}', 'utf-8');
  }

  // Also clear any active plan (plans are session-scoped)
  clearWorkspacePlan(workspaceId);
}

// ============================================
// Plan Storage (Session-Scoped)
// Plans are stored per-workspace and cleared with /clear
// ============================================

/**
 * Save a plan for a workspace.
 * Plans are session-scoped - they persist during the session but are
 * cleared when the user runs /clear or starts a new session.
 */
export function saveWorkspacePlan(workspaceId: string, plan: Plan): void {
  const dir = ensureWorkspaceDir(workspaceId);
  const filePath = join(dir, 'plan.json');
  writeFileSync(filePath, JSON.stringify(plan, null, 2), 'utf-8');
}

/**
 * Load the current plan for a workspace.
 * Returns null if no plan exists.
 */
export function loadWorkspacePlan(workspaceId: string): Plan | null {
  const filePath = join(WORKSPACES_DIR, workspaceId, 'plan.json');

  try {
    if (!existsSync(filePath)) {
      return null;
    }
    return readJsonFileSync<Plan>(filePath);
  } catch {
    return null;
  }
}

/**
 * Clear the plan for a workspace.
 * Called when user runs /clear or cancels a plan.
 */
export function clearWorkspacePlan(workspaceId: string): void {
  const filePath = join(WORKSPACES_DIR, workspaceId, 'plan.json');
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}

// ============================================
// Session Input Drafts
// Persists composer state (text + attachments) per session across app restarts.
// Two shapes for attachments:
//  - Track P: { path, name } — absolute path captured via webUtils.getPathForFile
//    (file-picker / OS drag). Re-read on hydrate via file:readUserAttachment RPC.
//  - Track C: { path, name, content } — inline content for paste / web-drag Files
//    that never existed on disk. Hydrate reconstructs directly from the stored bytes.
// ============================================

const DRAFTS_FILE = join(CONFIG_DIR, 'drafts.json');

export interface DraftAttachmentContent {
  type: 'image' | 'pdf' | 'text' | 'office' | 'audio' | 'unknown';
  mimeType: string;
  size: number;
  base64?: string;
  text?: string;
  thumbnailBase64?: string;
}

export interface DraftAttachmentRef {
  path: string;
  name: string;
  /** Inline content for attachments without a real filesystem path (paste, web-drag).
   *  When present, hydrate reconstructs from these bytes and skips any disk read. */
  content?: DraftAttachmentContent;
}

export interface SessionDraft {
  text: string;
  attachments?: DraftAttachmentRef[];
}

interface DraftsData {
  drafts: Record<string, SessionDraft>;
  updatedAt: number;
}

const ATTACHMENT_CONTENT_TYPES = new Set(['image', 'pdf', 'text', 'office', 'audio', 'unknown']);

function isAbsoluteDraftPath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith('/')) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  return false;
}

function isDraftAttachmentContent(value: unknown): value is DraftAttachmentContent {
  if (!value || typeof value !== 'object') return false;
  const c = value as DraftAttachmentContent;
  if (!ATTACHMENT_CONTENT_TYPES.has(c.type as string)) return false;
  if (typeof c.mimeType !== 'string') return false;
  if (typeof c.size !== 'number') return false;
  if (c.base64 !== undefined && typeof c.base64 !== 'string') return false;
  if (c.text !== undefined && typeof c.text !== 'string') return false;
  if (c.thumbnailBase64 !== undefined && typeof c.thumbnailBase64 !== 'string') return false;
  return true;
}

function isDraftAttachmentRef(value: unknown): value is DraftAttachmentRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as DraftAttachmentRef;
  if (typeof ref.path !== 'string' || typeof ref.name !== 'string') return false;
  if (ref.content !== undefined && !isDraftAttachmentContent(ref.content)) return false;
  // Post-migration guard: refs without content MUST have an absolute path. This rejects
  // the broken 0.8.11 shape (synthetic path === filename, no content) on first load —
  // user sees empty drafts once instead of attachments silently disappearing forever.
  if (ref.content === undefined && !isAbsoluteDraftPath(ref.path)) return false;
  return true;
}

function isSessionDraft(value: unknown): value is SessionDraft {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as SessionDraft;
  if (typeof candidate.text !== 'string') return false;
  if (candidate.attachments !== undefined) {
    if (!Array.isArray(candidate.attachments)) return false;
    if (!candidate.attachments.every(isDraftAttachmentRef)) return false;
  }
  return true;
}

function isEmptyDraft(draft: SessionDraft): boolean {
  return !draft.text && (!draft.attachments || draft.attachments.length === 0);
}

/**
 * Load all drafts from disk. Entries that don't parse as SessionDraft
 * (e.g. pre-upgrade string drafts) are discarded silently.
 */
function loadDraftsData(): DraftsData {
  try {
    if (!existsSync(DRAFTS_FILE)) {
      return { drafts: {}, updatedAt: 0 };
    }
    const raw = readJsonFileSync<{ drafts?: Record<string, unknown>; updatedAt?: number }>(DRAFTS_FILE);
    const drafts: Record<string, SessionDraft> = {};
    for (const [sessionId, value] of Object.entries(raw.drafts ?? {})) {
      if (isSessionDraft(value)) {
        drafts[sessionId] = value;
      }
    }
    return { drafts, updatedAt: raw.updatedAt ?? 0 };
  } catch {
    return { drafts: {}, updatedAt: 0 };
  }
}

function saveDraftsData(data: DraftsData): void {
  ensureConfigDir();
  data.updatedAt = Date.now();
  writeFileSync(DRAFTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Get the persisted draft for a session (text + attachment refs).
 */
export function getSessionDraft(sessionId: string): SessionDraft | null {
  const data = loadDraftsData();
  return data.drafts[sessionId] ?? null;
}

/**
 * Set the draft for a session. Empty drafts (no text and no attachments)
 * are removed from disk.
 */
export function setSessionDraft(sessionId: string, draft: SessionDraft): void {
  const data = loadDraftsData();
  if (isEmptyDraft(draft)) {
    delete data.drafts[sessionId];
  } else {
    data.drafts[sessionId] = {
      text: draft.text,
      ...(draft.attachments && draft.attachments.length > 0
        ? { attachments: draft.attachments.map(normalizeDraftAttachment) }
        : {}),
    };
  }
  saveDraftsData(data);
}

function normalizeDraftAttachment(ref: DraftAttachmentRef): DraftAttachmentRef {
  const base: DraftAttachmentRef = { path: ref.path, name: ref.name };
  if (ref.content && isDraftAttachmentContent(ref.content)) {
    const c = ref.content;
    base.content = {
      type: c.type,
      mimeType: c.mimeType,
      size: c.size,
      ...(c.base64 !== undefined ? { base64: c.base64 } : {}),
      ...(c.text !== undefined ? { text: c.text } : {}),
      ...(c.thumbnailBase64 !== undefined ? { thumbnailBase64: c.thumbnailBase64 } : {}),
    };
  }
  return base;
}

export function deleteSessionDraft(sessionId: string): void {
  const data = loadDraftsData();
  delete data.drafts[sessionId];
  saveDraftsData(data);
}

/**
 * Get all drafts as a record keyed by sessionId.
 */
export function getAllSessionDrafts(): Record<string, SessionDraft> {
  const data = loadDraftsData();
  return data.drafts;
}

// ============================================
// Theme Storage (App-level only)
// ============================================

import type { ThemeOverrides, ThemeFile, PresetTheme } from './theme.ts';

const APP_THEME_FILE = join(CONFIG_DIR, 'theme.json');
const APP_THEMES_DIR = join(CONFIG_DIR, 'themes');

/**
 * Get the path to the app-level theme override file (~/.otto/theme.json).
 */
export function getAppThemePath(): string {
  return APP_THEME_FILE;
}

// Track if preset themes have been synced this session (prevents re-init on hot reload)
let presetsInitialized = false;

/**
 * Get the app-level themes directory.
 * Preset themes are stored at ~/.otto/themes/
 */
export function getAppThemesDir(): string {
  return APP_THEMES_DIR;
}

/**
 * Load app-level theme overrides
 */
export function loadAppTheme(): ThemeOverrides | null {
  try {
    if (!existsSync(APP_THEME_FILE)) {
      return null;
    }
    return readJsonFileSync<ThemeOverrides>(APP_THEME_FILE);
  } catch {
    return null;
  }
}

/**
 * Save app-level theme overrides
 */
export function saveAppTheme(theme: ThemeOverrides): void {
  ensureConfigDir();
  writeFileSync(APP_THEME_FILE, JSON.stringify(theme, null, 2), 'utf-8');
}


// ============================================
// Preset Themes (app-level)
// ============================================

/**
 * Sync bundled preset themes to disk on launch.
 * Preserves user customizations:
 * - If file doesn't exist → copy from bundle
 * - If file exists but is invalid/corrupt → copy from bundle (auto-heal)
 * - If file exists and is valid → skip (preserve user changes)
 *
 * User-created custom theme files (with non-bundled filenames) are untouched.
 * User color overrides live in theme.json (separate file) and are never touched.
 */
export function ensurePresetThemes(): void {
  // Skip if already initialized this session (prevents re-init on hot reload)
  if (presetsInitialized) {
    return;
  }
  presetsInitialized = true;

  const themesDir = getAppThemesDir();

  // Create themes directory if it doesn't exist
  if (!existsSync(themesDir)) {
    mkdirSync(themesDir, { recursive: true });
  }

  // Resolve bundled themes directory via shared asset resolver
  const bundledThemesDir = getBundledAssetsDir('themes');
  if (!bundledThemesDir) {
    return;
  }

  // Copy bundled preset themes to disk, preserving user customizations.
  // - If file doesn't exist → copy from bundle
  // - If file exists but is invalid/corrupt → copy from bundle (auto-heal)
  // - If file exists and is valid → skip (preserve user changes)
  try {
    const bundledFiles = readdirSync(bundledThemesDir).filter(f => f.endsWith('.json'));
    for (const file of bundledFiles) {
      const srcPath = join(bundledThemesDir, file);
      const destPath = join(themesDir, file);

      // Skip if file exists and is valid (preserve user customizations)
      if (existsSync(destPath) && isValidThemeFile(destPath)) {
        continue;
      }

      // Copy from bundle (new file or auto-heal corrupt file)
      const content = readFileSync(srcPath, 'utf-8');
      writeFileSync(destPath, content, 'utf-8');
    }
  } catch {
    // Ignore errors - themes are optional
  }
}

/**
 * Load all preset themes from app themes directory.
 * Returns array of PresetTheme objects sorted by name.
 */
export function loadPresetThemes(): PresetTheme[] {
  ensurePresetThemes();

  const themesDir = getAppThemesDir();
  if (!existsSync(themesDir)) {
    return [];
  }

  const themes: PresetTheme[] = [];

  try {
    const files = readdirSync(themesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const id = file.replace('.json', '');
      const path = join(themesDir, file);
      try {
        const theme = readJsonFileSync<ThemeFile>(path);
        // Resolve relative backgroundImage paths to file:// URLs
        const resolvedTheme = resolveThemeBackgroundImage(theme, path);
        themes.push({ id, path, theme: resolvedTheme });
      } catch {
        // Skip invalid theme files
      }
    }
  } catch {
    return [];
  }

  // Sort by name (default first, then alphabetically)
  return themes.sort((a, b) => {
    if (a.id === 'default') return -1;
    if (b.id === 'default') return 1;
    return (a.theme.name || a.id).localeCompare(b.theme.name || b.id);
  });
}

/**
 * Get MIME type from file extension for data URL encoding.
 */
function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

/**
 * Resolve relative backgroundImage paths to data URLs.
 * If the backgroundImage is a relative path (no protocol), resolve it relative to the theme's directory,
 * read the file, and convert it to a data URL. This is necessary because the renderer process
 * cannot access file:// URLs directly when running on localhost in dev mode.
 * @param theme - Theme object to process
 * @param themePath - Absolute path to the theme's JSON file
 */
function resolveThemeBackgroundImage(theme: ThemeFile, themePath: string): ThemeFile {
  if (!theme.backgroundImage) {
    return theme;
  }

  // Check if it's already an absolute URL (has protocol like http://, https://, data:)
  const hasProtocol = /^[a-z][a-z0-9+.-]*:/i.test(theme.backgroundImage);
  if (hasProtocol) {
    return theme;
  }

  // It's a relative path - resolve it relative to the theme's directory
  const themeDir = dirname(themePath);
  const absoluteImagePath = join(themeDir, theme.backgroundImage);

  // Read the file and convert to data URL so renderer can use it
  // (file:// URLs are blocked in renderer when running on localhost)
  try {
    if (!existsSync(absoluteImagePath)) {
      console.warn(`Theme background image not found: ${absoluteImagePath}`);
      return theme;
    }

    const imageBuffer = readFileSync(absoluteImagePath);
    const base64 = imageBuffer.toString('base64');
    const mimeType = getMimeType(absoluteImagePath);
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      ...theme,
      backgroundImage: dataUrl,
    };
  } catch (error) {
    console.warn(`Failed to read theme background image: ${absoluteImagePath}`, error);
    return theme;
  }
}

/**
 * Load a specific preset theme by ID.
 * @param id - Theme ID (filename without .json)
 */
export function loadPresetTheme(id: string): PresetTheme | null {
  const themesDir = getAppThemesDir();
  const path = join(themesDir, `${id}.json`);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const theme = readJsonFileSync<ThemeFile>(path);
    // Resolve relative backgroundImage paths to file:// URLs
    const resolvedTheme = resolveThemeBackgroundImage(theme, path);
    return { id, path, theme: resolvedTheme };
  } catch {
    return null;
  }
}

/**
 * Get the path to the app-level preset themes directory.
 */
export function getPresetThemesDir(): string {
  return getAppThemesDir();
}

/**
 * Reset a preset theme to its bundled default.
 * Copies the bundled version over the user's version.
 * Resolves bundled path automatically via getBundledAssetsDir('themes').
 * @param id - Theme ID to reset
 */
export function resetPresetTheme(id: string): boolean {
  // Resolve bundled themes directory via shared asset resolver
  const bundledThemesDir = getBundledAssetsDir('themes');
  if (!bundledThemesDir) {
    return false;
  }

  const bundledPath = join(bundledThemesDir, `${id}.json`);
  const themesDir = getAppThemesDir();
  const destPath = join(themesDir, `${id}.json`);

  if (!existsSync(bundledPath)) {
    return false;
  }

  try {
    const content = readFileSync(bundledPath, 'utf-8');
    if (!existsSync(themesDir)) {
      mkdirSync(themesDir, { recursive: true });
    }
    writeFileSync(destPath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ============================================
// LLM Connections
// ============================================
//
// Thin wrappers over the connections domain (`@otto/shared/connections`), which is the one source of truth;
// they keep the names and the `LlmConnection` shape their callers use. A lookup with a `workspaceId` finds
// the workspace's own connection before the install's. The credential is not part of the shape: it lives in
// the connection's secret (the credential manager's `getLlm*` and `setLlm*` read and write it).

// Re-export types for convenience (imports are at top of file)
export type { ConnectionContext } from '../connections/index.ts';
export type {
  LlmConnection,
  LlmProviderType,
  LlmAuthType,
  LlmConnectionWithStatus,
} from './llm-connections.ts';

function toLlmConnection(c: Connection): LlmConnection {
  return {
    slug: c.slug,
    scope: c.scope,
    name: c.title,
    providerType: c.type,
    authType: c.authType,
    baseUrl: c.baseUrl ?? undefined,
    models: c.models ?? undefined,
    defaultModel: c.defaultModel ?? undefined,
    modelSelectionMode: c.config.modelSelectionMode,
    piAuthProvider: c.config.piAuthProvider,
    customEndpoint: c.config.customEndpoint,
    midStreamBehavior: c.config.midStreamBehavior,
    oauthAccountUuid: c.account.oauthAccountUuid,
    oauthAccountEmail: c.account.oauthAccountEmail,
    oauthOrganizationUuid: c.account.oauthOrganizationUuid,
    oauthOrganizationName: c.account.oauthOrganizationName,
    oauthProfileVerifiedAt: c.account.verifiedAt,
    createdAt: c.createdAt.getTime(),
  };
}

/** The domain's fields of a connection: what a create writes and what an update replaces. */
function toPatch(c: LlmConnection): ConnectionPatch {
  return {
    type: c.providerType,
    authType: c.authType,
    title: c.name,
    baseUrl: c.baseUrl ?? null,
    defaultModel: c.defaultModel ?? null,
    models: c.models ?? null,
    config: {
      modelSelectionMode: c.modelSelectionMode,
      piAuthProvider: c.piAuthProvider,
      customEndpoint: c.customEndpoint,
      midStreamBehavior: c.midStreamBehavior,
    },
    account: {
      oauthAccountUuid: c.oauthAccountUuid,
      oauthAccountEmail: c.oauthAccountEmail,
      oauthOrganizationUuid: c.oauthOrganizationUuid,
      oauthOrganizationName: c.oauthOrganizationName,
      verifiedAt: c.oauthProfileVerifiedAt,
    },
  };
}

/** The connections a context sees (the user's own, then the workspace's, then the install's, one per slug); the install's without one. */
export function getLlmConnections(where?: ConnectionContext): LlmConnection[] {
  return getConnections(where).map(toLlmConnection);
}

/**
 * Get a specific LLM connection by slug.
 * @returns Connection or null if not found
 */
export function getLlmConnection(slug: string, where?: ConnectionContext): LlmConnection | null {
  const connection = getConnection(slug, where);
  return connection ? toLlmConnection(connection) : null;
}

/** The context that sees a scope's own connections first. */
export const contextOfScope = (scope: string | undefined): ConnectionContext =>
  !scope ? {} :
  scope.startsWith('user:') ? { userId: scope.slice('user:'.length) } : scope.startsWith('workspace:') ? { workspaceId: scope.slice('workspace:'.length) } : {};

/**
 * Add a new LLM connection (to the install unless `scope` says otherwise), with its credential in the same transaction.
 * @returns true if added, false if the slug already exists in that scope
 */
export function addLlmConnection(connection: LlmConnection, options: { scope?: string; credential?: Credential } = {}): boolean {
  const scope = options.scope ?? INSTALL_SCOPE;
  if (getConnection(connection.slug, contextOfScope(scope))?.scope === scope) return false;
  createConnection(
    { ...(toPatch(connection) as ConnectionInput), slug: connection.slug, scope, createdAt: new Date(connection.createdAt || Date.now()) },
    options.credential,
  );
  return true;
}

/**
 * Update an existing LLM connection (a field left `undefined` stays as it is), and its credential in the same
 * transaction when one is given.
 * @returns true if updated, false if not found
 */
export function updateLlmConnection(
  slug: string,
  updates: Partial<Omit<LlmConnection, 'slug'>>,
  options: { where?: ConnectionContext; credential?: Credential } = {},
): boolean {
  const existing = getConnection(slug, options.where);
  if (!existing) return false;
  const merged = { ...toLlmConnection(existing) };
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && key !== 'createdAt') (merged as Record<string, unknown>)[key] = value;
  }
  updateConnection(existing.id, toPatch(merged), options.credential);
  return true;
}

/**
 * Delete an LLM connection and its credential.
 * @returns true if deleted, false if not found
 */
export function deleteLlmConnection(slug: string, where?: ConnectionContext): boolean {
  const existing = getConnection(slug, where);
  if (!existing) return false;
  deleteConnection(existing.id);

  // Clean up workspace references to the deleted connection (non-blocking)
  try {
    const workspaces = getWorkspaces();
    for (const ws of workspaces) {
      const wsConfig = loadWorkspaceConfig(ws.rootPath);
      if (wsConfig?.defaults?.defaultLlmConnection === slug) {
        wsConfig.defaults.defaultLlmConnection = undefined;
        saveWorkspaceConfig(ws.rootPath, wsConfig);
      }
    }
  } catch (error) {
    console.error('Failed to clean up workspace references:', error);
  }
  return true;
}

/**
 * Get the default LLM connection slug.
 * @returns Default connection slug, or null if no connections exist
 */
export function getDefaultLlmConnection(where?: ConnectionContext): string | null {
  return getDefaultConnection(where)?.slug ?? null;
}

/**
 * Set the default LLM connection.
 * @returns true if set, false if connection not found
 */
export function setDefaultLlmConnection(slug: string, where?: ConnectionContext): boolean {
  return setDefaultConnection(slug, where);
}

/** The app-level default thinking level for new sessions ('medium' until set). */
export function getDefaultThinkingLevel(): ThinkingLevel {
  return getSetting(INSTALL, 'defaultThinkingLevel');
}

/** Sets the app-level default thinking level for new sessions. */
export function setDefaultThinkingLevel(level: ThinkingLevel): boolean {
  updateSetting(INSTALL, 'defaultThinkingLevel', level);
  return true;
}

// ============================================
// Setup Deferred (user skipped onboarding)
// ============================================

export const isSetupDeferred = (): boolean => getSetting(INSTALL, 'setupDeferred');
export const setSetupDeferred = (deferred: boolean): void => void updateSetting(INSTALL, 'setupDeferred', deferred);

// ============================================
// Tool Icons (CLI tool icons for turn card display)
// ============================================

import { copyFileSync } from 'fs';

const TOOL_ICONS_DIR_NAME = 'tool-icons';

/**
 * Returns the path to the tool-icons directory: ~/.otto/tool-icons/
 */
export function getToolIconsDir(): string {
  return join(CONFIG_DIR, TOOL_ICONS_DIR_NAME);
}

/**
 * Ensure tool-icons directory exists and has bundled defaults.
 * Resolves bundled path automatically via getBundledAssetsDir('tool-icons').
 * Copies bundled tool-icons.json and icon files on first run.
 * Only copies files that don't already exist (preserves user customizations).
 */
export function ensureToolIcons(): void {
  const toolIconsDir = getToolIconsDir();

  // Create tool-icons directory if it doesn't exist
  if (!existsSync(toolIconsDir)) {
    mkdirSync(toolIconsDir, { recursive: true });
  }

  // Resolve bundled tool-icons directory via shared asset resolver
  const bundledToolIconsDir = getBundledAssetsDir('tool-icons');
  if (!bundledToolIconsDir) {
    return;
  }

  // Copy each bundled file if it doesn't exist in the target dir
  // This includes tool-icons.json and all icon files (png, ico, svg, jpg)
  try {
    const bundledFiles = readdirSync(bundledToolIconsDir);
    for (const file of bundledFiles) {
      const destPath = join(toolIconsDir, file);
      if (!existsSync(destPath)) {
        const srcPath = join(bundledToolIconsDir, file);
        copyFileSync(srcPath, destPath);
      }
    }
  } catch {
    // Ignore errors — tool icons are optional enhancement
  }
}

// ============================================
// Server Mode Configuration
// ============================================

/**
 * Get the current server configuration (the token is read from its secret).
 * Returns defaults if not yet configured.
 */
export function getServerConfig(): ServerConfig {
  const { tokenSecretId, ...stored } = getSetting(INSTALL, 'server');
  const token = tokenSecretId ? initSecretsStore().getSecret(tokenSecretId) : undefined;
  return { ...stored, ...(token ? { token } : {}) };
}

/**
 * Persist server configuration: the token goes to `secrets` (replaced in place), the setting keeps its id.
 * Auto-generates a stable auth token on first enable if none exists.
 */
export function setServerConfig(serverConfig: ServerConfig): void {
  const { token: given, ...rest } = serverConfig;
  const secrets = initSecretsStore();
  let tokenSecretId = getSetting(INSTALL, 'server').tokenSecretId;
  const token = given || (serverConfig.enabled && !(tokenSecretId && secrets.getSecret(tokenSecretId)) ? randomUUID() : undefined);
  if (token) {
    if (tokenSecretId && secrets.getSecret(tokenSecretId) !== undefined) secrets.updateSecret(tokenSecretId, token);
    else tokenSecretId = secrets.createSecret('Server token', token);
  }
  updateSetting(INSTALL, 'server', { ...rest, ...(tokenSecretId ? { tokenSecretId } : {}) });
}
