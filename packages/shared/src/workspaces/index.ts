/**
 * Workspace Module
 *
 * Re-exports types and storage functions for workspaces.
 */

// Types
export type {
  WorkspaceConfig,
  CreateWorkspaceInput,
  LoadedWorkspace,
  WorkspaceSummary,
  WorkspaceRole,
  WorkspaceMember,
  WorkspaceInvitation,
} from './types.ts';

// Storage functions
export {
  // Path utilities
  getDefaultWorkspacesDir,
  ensureDefaultWorkspacesDir,
  getWorkspacePath,
  getWorkspaceSourcesPath,
  getWorkspaceSessionsPath,
  getWorkspaceSkillsPath,
  // Config operations
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  // Load operations
  loadWorkspace,
  getWorkspaceSummary,
  // Create/Delete operations
  generateSlug,
  generateUniqueWorkspacePath,
  createWorkspaceAtPath,
  deleteWorkspaceFolder,
  isValidWorkspace,
  renameWorkspaceFolder,
  // Auto-discovery
  discoverWorkspacesInDefaultLocation,
  // Constants
  CONFIG_DIR,
  DEFAULT_WORKSPACES_DIR,
} from './storage.ts';

// Members and invitations (database)
export {
  createWorkspaceInvitation,
  createWorkspaceMember,
  deleteWorkspaceMember,
  getMemberRole,
  getMemberWorkspaceIds,
  getWorkspaceInvitation,
  getWorkspaceInvitations,
  getWorkspaceMembers,
  isWorkspaceMember,
  updateInvitationCanceled,
  updateWorkspaceMemberRole,
} from './members.ts';

// Who owns a workspace (private chats)
export { getWorkspaceOwnerIds, isWorkspaceOwner } from './ownership.ts';
