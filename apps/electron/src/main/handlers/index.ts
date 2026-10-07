import type { RpcServer } from '@otto/server-core/transport'
import type { GuiDeps } from './handler-deps'
import { registerSystemGuiHandlers } from './system'
import { registerWorkspaceGuiHandlers } from './workspace'
import { registerSettingsGuiHandlers } from './settings'

/** Main's own channels (`LOCAL_ONLY` in routing.ts); everything else is the server child's. */
export function registerGuiRpcHandlers(server: RpcServer, deps: GuiDeps): void {
  registerSystemGuiHandlers(server, deps)
  registerWorkspaceGuiHandlers(server, deps)
  registerSettingsGuiHandlers(server)
}
