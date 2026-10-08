export { initAgentApiUrl, getAgentApiUrl, initComputerApiUrl, createRunToken, getRunByToken, deleteRunToken, RUN_TOKEN_TTL_MS, type AgentRun } from './run-tokens.ts';
export type { AgentEvent } from '@otto/core/types';
export type { LoadedSource } from '../sources/types.ts';
export * from './conversation-summary.ts';
export * from './errors.ts';

export type { AuthRequest, AuthResult, CredentialAuthRequest, CredentialInputMode } from '@otto/session-tools-core';
export { getAgentComputer, getRunningAgentComputer, runComputerIdleStop } from './agent-turn.ts';
export type { ChatOptions } from './backend/types.ts';
export { AbortReason } from './core/session-lifecycle.ts';

// Export mode-manager - Centralized mode management
export {
  // Permission Mode API (primary)
  getPermissionMode,
  setPermissionMode,
  cyclePermissionMode,
  subscribeModeChanges,
  PERMISSION_MODE_ORDER,
  DEFAULT_PERMISSION_MODES,
  PERMISSION_MODE_CONFIG,
  availablePermissionModes,
  planExecutionMode,
  parsePermissionMode,
  isAutonomousPermissionMode,
  isPermissionMode,
  clampPermissionMode,
  type PermissionMode,
  getModeState,
  hydratePreviousPermissionMode,
  getPermissionModeDiagnostics,
  resolveEffectivePermissionMode,
  setGuardedModeActiveResolver,
  initializeModeState,
  cleanupModeState,
  // Tool blocking (centralized)
  shouldAllowToolInMode,
  blockWithReason,
  // Session state (lightweight per-message injection)
  getSessionState,
  formatSessionState,
  // Mode manager singleton (for advanced use cases)
  modeManager,
  // Default Explore mode patterns (for UI display)
  SAFE_MODE_CONFIG,
  // Types
  type ModeState,
  type ModeCallbacks,
  type ModeConfig,
  type PermissionModeChangedBy,
} from './mode-manager.ts';

// Export plan types and permission mode messages
export type { Plan, PlanStep, PlanState, PlanReviewRequest, PlanReviewResult } from './plan-types.ts';
export { PERMISSION_MODE_MESSAGES, PERMISSION_MODE_PROMPTS } from './plan-types.ts';

// Export thinking-levels - extended reasoning configuration
export {
  type ThinkingLevel,
  type ThinkingLevelDefinition,
  THINKING_LEVELS,
  DEFAULT_THINKING_LEVEL,
  getThinkingTokens,
  getThinkingLevelNameKey,
  isValidThinkingLevel,
} from './thinking-levels.ts';

// Export permissions-config - customizable permissions per workspace (a setting) and per source (permissions.json)
export {
  // Parser and validation
  parsePermissionsJson,
  validatePermissionsConfig,
  PermissionsConfigSchema,
  // API endpoint checking
  isApiEndpointAllowed,
  // Storage functions
  loadWorkspacePermissionsConfig,
  loadSourcePermissionsConfig,
  getSourcePermissionsPath,
  // Workspace rules (a setting) and raw source load/save
  getWorkspacePermissions,
  updateWorkspacePermissions,
  loadRawSourcePermissions,
  saveSourcePermissions,
  // App-level default permissions (at ~/.otto/permissions/)
  getAppPermissionsDir,
  ensureDefaultPermissions,
  loadDefaultPermissions,
  // Cache singleton
  permissionsConfigCache,
  // Types
  type ApiEndpointRule,
  type CompiledApiEndpointRule,
  type PermissionsCustomConfig,
  type PermissionsConfigFile,
  type MergedPermissionsConfig,
  type PermissionsContext,
} from './permissions-config.ts';

// Export browser tool name normalization helpers
export {
  LEGACY_BROWSER_TOOL_ALIASES,
  normalizeCanonicalBrowserToolName,
  normalizeBrowserToolName,
  isCanonicalBrowserToolName,
  isBrowserToolNameOrAlias,
} from './browser-tool-names.ts';

// Export PowerShell validator root setter (for Electron startup on Windows)
export { setPowerShellValidatorRoot } from './powershell-validator.ts';

// Guarded-mode risk check seam (the host implements the check; see core/guarded-mode.ts)
export type { GuardedModeCheck, GuardedModeCall, GuardedModeRisk, GuardedModeVerdict } from './core/guarded-mode.ts';
