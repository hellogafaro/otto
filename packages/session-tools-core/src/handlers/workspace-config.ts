/**
 * Workspace Config Handlers (labels_edit, statuses_edit, permissions_edit)
 *
 * The interim way for an agent to change the workspace's labels, statuses and Explore-mode permission rules, now that they
 * are database rows and no longer files an agent edits by path. Each call goes through the injected
 * `ctx.editWorkspaceConfig`, which runs the domain functions as the chat's user (owners write, members read).
 * The Python `otto` CLI will replace these tools.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

type Domain = 'labels' | 'statuses' | 'permissions';

async function edit(ctx: SessionToolContext, domain: Domain, args: Record<string, unknown>): Promise<ToolResult> {
  if (!ctx.editWorkspaceConfig) return errorResponse(`${domain}_edit is not available in this context.`);
  try {
    const result = await ctx.editWorkspaceConfig(domain, args);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    return errorResponse(`${domain}_edit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export const handleLabelsEdit = (ctx: SessionToolContext, args: Record<string, unknown>) => edit(ctx, 'labels', args);
export const handleStatusesEdit = (ctx: SessionToolContext, args: Record<string, unknown>) => edit(ctx, 'statuses', args);
export const handlePermissionsEdit = (ctx: SessionToolContext, args: Record<string, unknown>) => edit(ctx, 'permissions', args);
