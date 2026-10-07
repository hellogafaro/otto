/**
 * permissions_edit: read or replace the workspace's Explore-mode permission rules, through the injected
 * `ctx.editPermissions`, which runs as the chat's user (members read, owners write). The other workspace data
 * (labels, statuses, agents, routines, tasks...) agents reach with the `otto` CLI; these rules gate the agent itself,
 * so they stay a typed tool that goes through the permission handshake (docs/final-plan.md PT).
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export async function handlePermissionsEdit(ctx: SessionToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!ctx.editPermissions) return errorResponse('permissions_edit is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.editPermissions(args), null, 2));
  } catch (error) {
    return errorResponse(`permissions_edit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
