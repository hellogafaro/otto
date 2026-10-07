import type { PlatformServices } from '../runtime/platform'
import type { ISessionManager } from './session-manager-interface'
import type { IOAuthFlowStore } from './oauth-flow-store-interface'
import type { IMessagingGatewayRegistry } from './messaging-registry-interface'

/**
 * Generic handler dependency bag.
 * Hosts may specialize these generics to their runtime implementations;
 * TSessionManager defaults to ISessionManager and TOAuthFlowStore to IOAuthFlowStore.
 * The server has no windows: a request's workspace is its connection's (`ctx.workspaceId`).
 */
export interface HandlerDeps<
  TSessionManager extends ISessionManager = ISessionManager,
  TOAuthFlowStore extends IOAuthFlowStore = IOAuthFlowStore,
> {
  sessionManager: TSessionManager
  platform: PlatformServices
  oauthFlowStore: TOAuthFlowStore
  messagingRegistry?: IMessagingGatewayRegistry
}
