/**
 * What main's handlers need: its windows and browser panes. Main has no database and no session manager; the
 * server child owns those (docs/desktop.md).
 */

import type { WindowManager } from '../window-manager'
import type { BrowserPaneManager } from '../browser-pane-manager'

export interface GuiDeps {
  windowManager: WindowManager
  browserPaneManager: BrowserPaneManager
}
