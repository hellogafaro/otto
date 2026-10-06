/**
 * Status Validation
 *
 * Runtime validation for session status IDs.
 * Ensures sessions always have valid status references.
 */

import { getWorkspaceIdByRootPath } from '../config/storage.ts';
import { isValidStatusId } from './storage.ts';

/**
 * Validate and normalize a session's status
 * If invalid or undefined, returns 'todo' as fallback
 *
 * @param workspaceRootPath - Workspace root path (chat storage still addresses a workspace by it)
 * @param sessionStatus - Status ID to validate
 * @returns Valid status ID (or 'todo' fallback)
 */
export function validateSessionStatus(
  workspaceRootPath: string,
  sessionStatus: string | undefined
): string {
  // Default to 'todo' if undefined
  if (!sessionStatus) {
    return 'todo';
  }

  // Check if status exists in the workspace (a root that is not registered has the defaults)
  if (isValidStatusId(getWorkspaceIdByRootPath(workspaceRootPath) ?? '', sessionStatus)) {
    return sessionStatus;
  }

  // Invalid status - log warning and fallback to 'todo'
  console.warn(
    `[validateSessionStatus] Invalid status '${sessionStatus}' for workspace, ` +
    `falling back to 'todo'. The status may have been deleted.`
  );

  return 'todo';
}
