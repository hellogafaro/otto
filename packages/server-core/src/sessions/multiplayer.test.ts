import { describe, expect, it } from 'bun:test'
import { createAgent } from '@otto/shared/agents'
import { assembleInstructions } from '@otto/shared/agents'
import type { ChatLogRow } from '@otto/shared/sessions'
import type { Workspace } from '@otto/shared/config'
import { buildAgentPrompt, hasSeveralAuthors, MAX_AGENT_CHAIN_DEPTH, routeAgentReply, routeMessage } from './multiplayer.ts'
import { createManagedSession, SessionManager } from './session-manager.ts'

const A = 'agentaaaaaaa'
const B = 'agentbbbbbbb'
const ANA = 'user:anaaaaaaaaaa'
const BEN = 'user:benbbbbbbbbb'
const agents = new Set([A, B])

describe('routeMessage: which agents a person wakes', () => {
  const route = (text: string, people: number, primary: string | null) => routeMessage({ text, people, primaryAgentId: primary ?? undefined, agents })

  it.each([
    ['one person, no mention: the primary agent', 'hello', 1, A, [A]],
    ['several people, no mention: nobody (people talk)', 'hello', 2, A, []],
    ['a people chat (no primary), no mention: nobody', 'hello', 1, null, []],
    ['a mention: that agent, also with several people', `ask agent:${B} please`, 3, A, [B]],
    ['mentions in order, once each', `agent:${B} then agent:${A} and agent:${B}`, 2, A, [B, A]],
    ['only people mentioned: nobody, even with one person', `ping ${BEN}`, 1, A, []],
    ['an unknown agent is no mention', 'agent:zzzzzzzzzzzz hi', 1, A, [A]],
  ])('%s', (_name, text, people, primary, expected) => {
    expect(route(text as string, people as number, primary as string | null)).toEqual(expected as string[])
  })

  it('an agent reply hands work to the agents it mentions, never itself', () => {
    expect(routeAgentReply(`I asked agent:${A} and agent:${B}`, A, agents)).toEqual([B])
    expect(routeAgentReply('done', A, agents)).toEqual([])
  })
})

const row = (position: number, type: string, text: string, who: { sender?: string; author?: string } = {}, extra: Partial<ChatLogRow> = {}): ChatLogRow => ({
  position, id: `m${position}`, type, text, sender: who.sender ?? null, author: who.author ?? null, hidden: false, intermediate: false, ...extra,
})
const names: Record<string, string> = { [ANA]: 'Ana', [BEN]: 'Ben', [`agent:${A}`]: 'Scout', [`agent:${B}`]: 'Writer' }
const nameOf = (actor: string) => names[actor] ?? actor

describe('buildAgentPrompt: what an agent is given (its own Pi session)', () => {
  it('one person and one agent: exactly the message, no prefix (as before multiplayer)', () => {
    const unseen = [row(3, 'assistant', 'earlier answer', { author: `agent:${A}` }), row(4, 'user', 'hi there', { sender: ANA })]
    const prompt = buildAgentPrompt({ agentId: A, unseen, current: { ids: ['m4'], text: 'hi there', author: ANA }, chat: { createdBy: ANA, primaryAgentId: A }, prefix: hasSeveralAuthors([ANA, `agent:${A}`], A), nameOf })
    expect(prompt).toBe('hi there')
  })

  it('several authors: every other author is a user line with [name]; its own replies and hidden or intermediate rows are left out', () => {
    const unseen = [
      row(5, 'user', 'what do you think?', { sender: BEN }),
      row(6, 'assistant', 'my own reply', { author: `agent:${A}` }),
      row(7, 'assistant', 'thinking...', { author: `agent:${B}` }, { intermediate: true }),
      row(8, 'assistant', 'Writer here: a draft', { author: `agent:${B}` }),
      row(9, 'user', 'nudge', {}, { hidden: true }),
      row(10, 'user', `agent:${A} your turn`, { sender: ANA }),
    ]
    const prompt = buildAgentPrompt({
      agentId: A, unseen, current: { ids: ['m10'], text: `agent:${A} your turn`, author: ANA }, chat: { createdBy: ANA, primaryAgentId: A },
      prefix: hasSeveralAuthors([ANA, BEN, `agent:${A}`, `agent:${B}`], A), nameOf,
    })
    expect(prompt).toBe(`[Ben] what do you think?\n\n[Writer] Writer here: a draft\n\n[Ana] agent:${A} your turn`)
  })

  it('a turn another agent woke has no message of its own: only what it has not seen; old rows read as creator and primary', () => {
    const unseen = [row(2, 'user', 'legacy question'), row(3, 'assistant', 'legacy answer'), row(4, 'assistant', `over to agent:${B}`, { author: `agent:${A}` })]
    const prompt = buildAgentPrompt({ agentId: B, unseen, chat: { createdBy: ANA, primaryAgentId: A }, prefix: true, nameOf })
    expect(prompt).toBe(`[Ana] legacy question\n\n[Scout] legacy answer\n\n[Scout] over to agent:${B}`)
  })

  it('hasSeveralAuthors counts the authors besides the agent', () => {
    expect(hasSeveralAuthors([ANA, ANA, `agent:${A}`], A)).toBe(false)
    expect(hasSeveralAuthors([ANA, `agent:${B}`, `agent:${A}`], A)).toBe(true)
    expect(hasSeveralAuthors([ANA, BEN], A)).toBe(true)
  })
})

describe('<otto_chat>: the other participants in the instructions', () => {
  it('lists people and other agents when there are several, nothing otherwise', () => {
    const base = { product: 'Otto', workspaceInstructions: '', agent: { title: 'Scout', instructions: 'Be brief.' } }
    expect(assembleInstructions({ ...base, chat: { people: [{ name: 'Ana', actor: ANA }], agents: [] } })).not.toContain('otto_chat')
    const text = assembleInstructions({ ...base, chat: { self: `Scout (agent:${A})`, people: [{ name: 'Ana', actor: ANA }, { name: 'Ben', actor: BEN }], agents: [{ name: 'Writer', actor: `agent:${B}` }] } })
    expect(text).toContain(`You are Scout (agent:${A}): a message with that token is addressed to you.`)
    expect(text).toContain('<otto_chat>')
    expect(text).toContain(`People: Ana (${ANA}), Ben (${BEN})`)
    expect(text).toContain(`Other agents: Writer (agent:${B})`)
  })
})

const WS: Workspace = { id: 'wsmultiplayr', name: 'Main', rootPath: '/tmp/otto-mp-ws', createdAt: 0 } as Workspace

function manager() {
  const sm = new SessionManager()
  const events: Array<{ type: string; userIds: string[]; hasUnread?: boolean }> = []
  sm.setEventSink((_channel, target: any, payload: any) => events.push({ type: payload?.type, userIds: target.userIds, hasUnread: payload?.hasUnread }))
  return { sm, events, sessions: (sm as unknown as { sessions: Map<string, any> }).sessions }
}

describe('a people chat in the session manager', () => {
  it('a message with no agent mention runs nothing (no agent, no connection needed) and is unread for the other members only', async () => {
    const { sm, events, sessions } = manager()
    const chat = createManagedSession({ id: 'dmchat000001', createdBy: ANA, dmKey: `${ANA}|${BEN}`, lastMessageAt: 1 }, WS, {
      members: [{ actor: ANA, readAt: 1 }, { actor: BEN, readAt: 1 }],
      messagesLoaded: true,
    })
    sessions.set(chat.id, chat)
    let acked = ''
    await sm.sendMessage(chat.id, 'lunch?', undefined, undefined, { sender: ANA }, undefined, undefined, (id) => (acked = id))

    expect(acked).not.toBe('')
    expect(chat.agent).toBeNull()
    expect(chat.isProcessing).toBe(false)
    expect(chat.messages.map((m: { role: string; sender?: string }) => [m.role, m.sender])).toEqual([['user', ANA]])
    expect(events.filter((e) => e.type === 'complete')).toEqual([
      { type: 'complete', userIds: ['anaaaaaaaaaa'], hasUnread: false },
      { type: 'complete', userIds: ['benbbbbbbbbb'], hasUnread: true },
    ])
    // Ben reads it by viewing it
    sm.setActiveViewingSession(chat.id, WS.id, 'benbbbbbbbbb')
    await Bun.sleep(1)
    expect(sm.getSessions(WS.id, 'benbbbbbbbbb')[0]!.hasUnread).toBe(false)
  })
})

describe('agent handoffs', () => {
  it('a reply that mentions another agent queues its turn, at most MAX_AGENT_CHAIN_DEPTH deep, and makes it a member', () => {
    const scout = createAgent({ workspaceId: WS.id, title: 'Scout', provider: 'anthropic', createdBy: ANA })
    const writer = createAgent({ workspaceId: WS.id, title: 'Writer', provider: 'anthropic', createdBy: ANA })
    const { sessions, sm } = manager()
    const chat = createManagedSession({ id: 'handoff00001', createdBy: ANA, agentId: scout.id, lastMessageAt: 1 }, WS, {
      members: [{ actor: ANA, readAt: 1 }, { actor: `agent:${scout.id}`, readAt: null }],
      messagesLoaded: true,
    })
    chat.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1, sender: ANA },
      { id: 'a1', role: 'assistant', content: `handing to agent:${writer.id}`, timestamp: 2, author: `agent:${scout.id}` },
    ]
    sessions.set(chat.id, chat)
    const handoff = (depth: number) => {
      chat.messageQueue = []
      chat.turnAgentId = scout.id
      chat.turnDepth = depth
      chat.agentTurnsLeft = 8
      ;(sm as unknown as { queueAgentHandoffs(m: unknown, start?: string): void }).queueAgentHandoffs(chat, 'u1')
      return chat.messageQueue.map((entry: { wake?: unknown }) => entry.wake)
    }

    expect(handoff(0)).toEqual([{ agentId: writer.id, depth: 1 }])
    expect(chat.members.map((m: { actor: string }) => m.actor)).toContain(`agent:${writer.id}`)
    expect(handoff(MAX_AGENT_CHAIN_DEPTH - 1)).toEqual([{ agentId: writer.id, depth: MAX_AGENT_CHAIN_DEPTH }])
    expect(handoff(MAX_AGENT_CHAIN_DEPTH)).toEqual([])
    // the per-message cap
    chat.agentTurnsLeft = 0
    chat.messageQueue = []
    ;(sm as unknown as { queueAgentHandoffs(m: unknown, start?: string): void }).queueAgentHandoffs(chat, 'u1')
    expect(chat.messageQueue).toEqual([])
  })
})
