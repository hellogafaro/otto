/**
 * @otto/shared
 *
 * Shared business logic for Otto.
 * Used by the Electron app.
 *
 * Import specific modules via subpath exports:
 *   import { Otto } from '@otto/shared/agent';
 *   import { loadStoredConfig } from '@otto/shared/config';
 *   import { getCredentialManager } from '@otto/shared/credentials';
 *   import { OttoMcpClient } from '@otto/shared/mcp';
 *   import { debug } from '@otto/shared/utils';
 *   import { loadSource, createSource, getSourceCredentialManager } from '@otto/shared/sources';
 *   import { createWorkspace, loadWorkspace } from '@otto/shared/workspaces';
 *
 * Available modules:
 *   - agent: Otto SDK wrapper, plan tools
 *   - auth: OAuth, token management, auth state
 *   - clients: Craft API client
 *   - config: Storage, models, preferences
 *   - credentials: Encrypted credential storage
 *   - mcp: MCP client, connection validation
 *   - prompts: System prompt generation
 *   - sources: Workspace-scoped source management (MCP, API, local)
 *   - utils: Debug logging, file handling, summarization
 *   - validation: URL validation
 *   - version: Version and installation management
 *   - workspaces: Workspace management (top-level organizational unit)
 */

// Export branding (standalone, no dependencies)
export * from './branding.ts';
