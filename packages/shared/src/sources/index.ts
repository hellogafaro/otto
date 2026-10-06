/**
 * Sources Module
 *
 * Public exports for source management. A source is a folder (`config.json`, `guide.md`, an icon,
 * `permissions.json`); rows in `sources` index them, the bytes are bundles in S3 (a folder of the workspace on disk)
 * and `<workspace>/sources/<slug>/` is the local copy agents read by path, as with skills; see ./store.ts. A source's
 * credential is a secret of the `secrets` table, kept by the row. The `load*` functions below read the local copy;
 * the rows (`getSources`, `getLoadedSources`) say which sources exist.
 */

import { getWorkspaces } from '../config/storage.ts';
import { initSourcesImport as runSourcesImport } from './import.ts';
import { initSourcesStore, syncSources } from './rows.ts';

// Types
export type {
  SourceType,
  SourceMcpAuthType,
  ApiAuthType,
  KnownProvider,
  ApiOAuthProvider,
  ApiOAuthConfig,
  McpSourceConfig,
  ApiSourceConfig,
  LocalSourceConfig,
  SourceConnectionStatus,
  FolderSourceConfig,
  SourceGuide,
  LoadedSource,
  CreateSourceInput,
  ApiRenewEndpoint,
} from './types.ts';

// Constants and helpers
export {
  API_OAUTH_PROVIDERS,
  isApiOAuthProvider,
  isGenericOAuthSource,
  hasRenewEndpoint,
  isRefreshableSource,
} from './types.ts';

// Rows (the index), their credentials and the sync of folder and bucket
export {
  getSources,
  getSource,
  getLoadedSources,
  deleteSource,
  syncLocalSource,
  syncSources,
  getSourceCredential,
  setSourceCredential,
  deleteSourceCredential,
  deleteWorkspaceSourceCredentials,
} from './rows.ts';
export { authStatusOf, createSourcesStore, type SourceCredentialType, type SourcesTarget, type SyncStatus } from './store.ts';
export type { SourcesImportReport } from './import.ts';

/** Imports the source folders and credentials of every workspace once (see import.ts). */
export const initSourcesImport = (workspaces?: { id: string; rootPath: string; remoteServer?: unknown }[]) =>
  runSourcesImport(initSourcesStore(), { workspaces });

/**
 * Boot, once the schema is pushed (and when a workspace is added): imports what was never imported, then brings every
 * workspace's folders and bundles together, which on S3 is the materializer. A workspace that cannot be synced (the
 * bucket is down) is logged and left as it is; the server still starts and the folder that is there keeps working.
 */
export async function initSources(): Promise<void> {
  await initSourcesImport();
  for (const workspace of getWorkspaces()) {
    if (workspace.remoteServer) continue;
    await syncSources(workspace.id).catch((error) => console.warn(`[sources] could not sync ${workspace.id}: ${error instanceof Error ? error.message : String(error)}`));
  }
}

// Storage functions
export {
  // Directory utilities
  ensureSourcesDir,
  getSourcePath,
  getSourceWorkspaceId,
  // Config operations
  loadSourceConfig,
  saveSourceConfig,
  markSourceAuthenticated,
  // Guide operations
  loadSourceGuide,
  saveSourceGuide,
  // Icon operations
  findSourceIcon,
  downloadSourceIcon,
  sourceNeedsIconDownload,
  isIconUrl,
  // Load operations
  loadSource,
  loadWorkspaceSources,
  loadAllSources,
  getEnabledSources,
  isSourceUsable,
  getSourcesBySlugs,
  // Create/Delete operations
  generateSourceSlug,
  createSource,
  sourceExists,
  // Parsing utilities
  parseGuideMarkdown,
  extractTagline,
} from './storage.ts';

// Credential Manager (unified credential operations)
export {
  SourceCredentialManager,
  getSourceCredentialManager,
  getSourcesNeedingAuth,
  isMultiHeaderCredential,
  parseStoredApiCredential,
  serializeHeaderCredential,
} from './credential-manager.ts';
export type {
  AuthResult,
  ApiCredential,
  BasicAuthCredential,
  MultiHeaderCredential,
} from './credential-manager.ts';

// Server Builder (builds MCP/API servers from sources)
export {
  SourceServerBuilder,
  getSourceServerBuilder,
  normalizeMcpUrl,
  SERVER_BUILD_ERRORS,
} from './server-builder.ts';
export type {
  McpServerConfig,
  SourceWithCredential,
  BuiltServers,
} from './server-builder.ts';

// API Tools (types)
export type { SummarizeCallback } from './api-tools.ts';
export {
  executeApiRequest,
  ApiResponseTooLargeError,
  type ApiRequestInput,
  type ExecuteApiRequestOptions,
  type ApiRequestOutcome,
  type ApiCredentialSource,
} from './api-tools.ts';

// Token Refresh Manager (handles OAuth token refresh with rate limiting)
export {
  TokenRefreshManager,
  createTokenGetter,
} from './token-refresh-manager.ts';
export type {
  TokenRefreshResult,
  RefreshManagerOptions,
} from './token-refresh-manager.ts';
