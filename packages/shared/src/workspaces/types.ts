/**
 * Workspace Types
 *
 * Workspaces are the top-level organizational unit. Everything (sources, sessions)
 * is scoped to a workspace.
 *
 * Directory structure:
 * ~/.otto/workspaces/{slug}/
 *   ├── config.json      - Workspace settings
 *   ├── sources/         - Data sources (MCP, API, local)
 *   └── sessions/        - Conversation sessions
 */

import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';

/**
 * Local MCP server configuration
 * Controls whether stdio-based (local subprocess) MCP servers can be spawned.
 */
export interface LocalMcpConfig {
  /**
   * Whether local (stdio) MCP servers are enabled for this workspace.
   * When false, only HTTP-based MCP servers will be used.
   * Default: true (can be overridden by OTTO_LOCAL_MCP_ENABLED env var)
   */
  enabled: boolean;
}

/**
 * Workspace configuration (stored in config.json)
 */
export interface WorkspaceConfig {
  id: string;
  name: string;
  slug: string; // Folder name (URL-safe)

  /**
   * Default settings for new sessions in this workspace
   */
  defaults?: {
    model?: string;
    /** Default LLM connection for new sessions (slug). Overrides global default. */
    defaultLlmConnection?: string;
    enabledSourceSlugs?: string[]; // Sources to enable by default
    permissionMode?: PermissionMode; // Default permission mode ('safe', 'ask', 'guarded', 'allow-all')
    cyclablePermissionModes?: PermissionMode[]; // Which modes can be cycled with SHIFT+TAB (min 2, default: Explore, Ask, Execute)
    workingDirectory?: string;
    thinkingLevel?: ThinkingLevel; // Default thinking level for new sessions (default: 'medium')
  };

  /**
   * Local MCP server configuration.
   * Controls whether stdio-based MCP servers can be spawned in this workspace.
   * Resolution order: ENV (OTTO_LOCAL_MCP_ENABLED) > workspace config > default (true)
   */
  localMcpServers?: LocalMcpConfig;

  createdAt: number;
  updatedAt: number;
}

/**
 * Workspace creation input
 */
export interface CreateWorkspaceInput {
  name: string;
  defaults?: WorkspaceConfig['defaults'];
}

/**
 * Loaded workspace with resolved sources
 */
export interface LoadedWorkspace {
  config: WorkspaceConfig;
  sourceSlugs: string[]; // Available source slugs (not fully loaded to save memory)
  sessionCount: number; // Number of sessions
}

/**
 * Workspace summary for listing (lightweight)
 */
export interface WorkspaceSummary {
  slug: string;
  name: string;
  sourceCount: number;
  sessionCount: number;
  createdAt: number;
  updatedAt: number;
}

/** A person's role in a workspace. */
export type WorkspaceRole = 'owner' | 'member'

/** `actor` is the member as an actor ('user:<userId>'), what tasks and projects store. */
export interface WorkspaceMember {
  actor: string
  userId: string
  name: string
  email: string
  role: WorkspaceRole
  /** Set on the caller's own entry only. */
  me?: true
}

/** A pending invitation. `link` is what the owner sends: the invitee opens it to sign up and accept. */
export interface WorkspaceInvitation {
  id: string
  email: string
  expiresAt: number
  link: string
}
