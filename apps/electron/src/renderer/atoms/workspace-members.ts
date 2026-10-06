/** The workspace's members as the server lists them (`useWorkspaceMemberList` loads it; the caller's entry has `me`). */

import type { WorkspaceMember } from '../../shared/types'
import { workspaceListAtom } from './workspace-list'

export const workspaceMembersAtom = workspaceListAtom<WorkspaceMember>()
