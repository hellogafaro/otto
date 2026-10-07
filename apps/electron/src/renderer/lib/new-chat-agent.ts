/**
 * The agent a new chat starts with in a workspace: the last one picked in the composer's agent picker (this browser,
 * per workspace). None, or one that was deleted, is the workspace's default agent (the server falls back to it).
 */

import * as storage from './local-storage'

export const getNewChatAgentId = (workspaceId: string): string | undefined => storage.get<string>(storage.KEYS.newChatAgent, '', workspaceId) || undefined

export const setNewChatAgentId = (workspaceId: string, agentId: string): void => storage.set(storage.KEYS.newChatAgent, agentId, workspaceId)
