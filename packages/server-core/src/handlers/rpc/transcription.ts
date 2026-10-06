import { userIdOf } from '@otto/shared/actors'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { TRANSCRIPTION_MAX_BYTES, runTranscription } from '@otto/shared/transcription'
import { domainError } from '@otto/shared/utils'
import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { actorOf, resolveWorkspace } from './library'

export const HANDLED_CHANNELS = [RPC_CHANNELS.transcription.CREATE] as const

/**
 * Dictation: a member sends one recording and gets its text. The guard has already checked the caller belongs to the
 * connection's workspace; the key is the `openrouter` connection that user and workspace see (the user's own first).
 */
export function registerTranscriptionHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.transcription.CREATE, async (ctx, audioBase64: string, type: string) => {
    const where = { userId: userIdOf(actorOf(ctx)), workspaceId: resolveWorkspace(ctx, deps).id }
    if (typeof audioBase64 !== 'string' || typeof type !== 'string') throw domainError('invalid', 'Send the recording as base64 and its audio/* type')
    // base64 is 4 bytes for 3: refuse an oversized body before decoding it
    if (audioBase64.length > Math.ceil(TRANSCRIPTION_MAX_BYTES / 3) * 4) throw domainError('too_large', 'The recording is too long')
    return { text: await runTranscription(where, Buffer.from(audioBase64, 'base64'), type) }
  })
}
