/**
 * What main's handlers need: its windows. Main has no database and no session manager; the
 * server child owns those (docs/desktop.md).
 */

import type { WindowManager } from '../window-manager'

export interface GuiDeps {
  windowManager: WindowManager
}
