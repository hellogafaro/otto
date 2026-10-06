/** The signed-in user's notifications in the workspace, newest first (`useNotifications` loads it). */

import type { NotificationItem } from '../../shared/types'
import { workspaceListAtom } from './workspace-list'

export const notificationsAtom = workspaceListAtom<NotificationItem>()
