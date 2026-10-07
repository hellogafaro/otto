import { afterEach, describe, expect, it } from 'bun:test'
import { createRunToken, deleteRunToken, getRunByToken, initAgentApiUrl, RUN_TOKEN_TTL_MS } from '../run-tokens.ts'

const RUN = { chatId: 'chat00000001', workspaceId: 'ws0000000001', userId: 'user00000001', agentId: 'agent0000001' }

afterEach(() => initAgentApiUrl(null))

describe('run tokens', () => {
  it('mints nothing while no server listens for agents', () => {
    expect(createRunToken(RUN)).toBeNull()
  })

  it('stands for its run until deleted, and hands out the bash env', () => {
    initAgentApiUrl('http://127.0.0.1:4100')
    const minted = createRunToken(RUN)!
    expect(minted.env).toEqual({ OTTO_API_URL: 'http://127.0.0.1:4100', OTTO_RUN_TOKEN: minted.token })
    expect(minted.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/)
    expect(getRunByToken(minted.token)).toMatchObject({ ...RUN, id: minted.token.split('.')[0] })
    deleteRunToken(minted.token)
    expect(getRunByToken(minted.token)).toBeNull()
  })

  it('refuses a wrong secret, a token of another run, garbage and non-strings alike', () => {
    initAgentApiUrl('http://127.0.0.1:4100')
    const a = createRunToken(RUN)!
    const b = createRunToken({ ...RUN, userId: 'user00000002' })!
    const [idA, secretA] = a.token.split('.')
    const [idB, secretB] = b.token.split('.')
    expect(getRunByToken(`${idA}.${secretB}`)).toBeNull()
    expect(getRunByToken(`${idB}.${secretA}`)).toBeNull()
    expect(getRunByToken(`${idA}.`)).toBeNull()
    expect(getRunByToken(idA)).toBeNull()
    expect(getRunByToken(`.${secretA}`)).toBeNull()
    expect(getRunByToken(undefined)).toBeNull()
    expect(getRunByToken(42)).toBeNull()
    expect(getRunByToken(b.token)?.userId).toBe('user00000002')
  })

  it('expires after the TTL even when the turn end was never seen', () => {
    initAgentApiUrl('http://127.0.0.1:4100')
    const now = 1_000_000
    const { token } = createRunToken(RUN, now)!
    expect(getRunByToken(token, now + RUN_TOKEN_TTL_MS - 1)).not.toBeNull()
    expect(getRunByToken(token, now + RUN_TOKEN_TTL_MS)).toBeNull()
    // Gone for good, not only at that instant
    expect(getRunByToken(token, now)).toBeNull()
  })

  it('never returns the stored hash', () => {
    initAgentApiUrl('http://127.0.0.1:4100')
    const { token } = createRunToken(RUN)!
    expect(Object.keys(getRunByToken(token)!).sort()).toEqual(['agentId', 'chatId', 'expiresAt', 'id', 'userId', 'workspaceId'])
  })
})
