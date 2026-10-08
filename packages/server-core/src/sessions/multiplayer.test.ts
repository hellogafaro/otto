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
    expect(chat.mastraSession).toBeUndefined()
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

// --- The rules wired in the session manager, on the test database (scripts/test-preload.ts: never ~/.otto) ---

const { users } = await import('../../../shared/src/users/schema.ts')
const { initDb } = await import('@otto/shared/db')
const { createWorkspaceMember } = await import('@otto/shared/workspaces')
const { addWorkspace, saveConfig } = await import('@otto/shared/config')
const { getChatLog } = await import('@otto/shared/sessions')
const { getChat } = await import('../../../shared/src/sessions/chats.ts')

const CAL = 'user:calccccccccc'
for (const [actor, name] of [[ANA, 'Ana'], [BEN, 'Ben'], [CAL, 'Cal']] as const) {
  const now = new Date()
  initDb().insert(users).values({ id: actor.slice(5), name, email: `${name.toLowerCase()}@example.test`, createdAt: now, updatedAt: now }).onConflictDoNothing().run()
}
const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { code?: string }) => error.code ?? String(error))
const userMsg = (id: string, sender: string, content: string, timestamp: number) => ({ id, role: 'user' as const, content, timestamp, sender })
const agentMsg = (id: string, agentId: string, content: string, timestamp: number) => ({ id, role: 'assistant' as const, content, timestamp, author: `agent:${agentId}` })

describe('who replies, in the session manager (a turn is running)', () => {
  const scout = createAgent({ workspaceId: WS.id, title: 'Scout', provider: 'anthropic', createdBy: ANA })
  const writer = createAgent({ workspaceId: WS.id, title: 'Writer', provider: 'anthropic', createdBy: ANA })

  /** A chat whose `scout` turn is running (no live process: nothing can be steered, so a message for it queues). */
  function running(id: string, people: string[]) {
    const { sm, sessions } = manager()
    const chat = createManagedSession({ id, createdBy: people[0], agentId: scout.id, lastMessageAt: 1 }, WS, {
      members: [...people.map((actor) => ({ actor, readAt: 1 })), { actor: `agent:${scout.id}`, readAt: null }],
      messagesLoaded: true,
    })
    chat.isProcessing = true
    chat.turnAgentId = scout.id
    sessions.set(chat.id, chat)
    const send = (sender: string, text: string) => sm.sendMessage(chat.id, text, undefined, undefined, { sender }, undefined, undefined, () => {})
    const queued = () => chat.messageQueue.map((entry: { agentIds?: string[] }) => entry.agentIds)
    return { chat, send, queued }
  }

  it('several people: no mention wakes nobody, a people-only mention neither; an agent mention queues that agent, which joins', async () => {
    const { chat, send, queued } = running('routegroup01', [ANA, BEN])
    await send(BEN, 'hello all')
    await send(BEN, `ping ${ANA}`)
    expect(queued()).toEqual([])
    await send(BEN, `agent:${writer.id} draft it`)
    expect(queued()).toEqual([[writer.id]])
    expect(chat.members.map((m: { actor: string }) => m.actor)).toContain(`agent:${writer.id}`)
    await send(ANA, `agent:${scout.id} and this`)
    expect(queued()).toEqual([[writer.id], [scout.id]])
    // every message is in the log with its sender, the ones nobody answers too
    expect(chat.messages.map((m: { sender?: string }) => m.sender)).toEqual([BEN, BEN, BEN, ANA])
  })

  it('one person: no mention queues the primary agent; a people-only mention wakes nobody', async () => {
    const { send, queued } = running('routesolo001', [ANA])
    await send(ANA, 'and also')
    await send(ANA, `tell ${BEN} later`)
    expect(queued()).toEqual([[scout.id]])
  })

  it('an idle chat of several people with a primary agent: a message with no mention runs nothing and is news for the others', async () => {
    const { sm, sessions, events } = manager()
    const chat = createManagedSession({ id: 'routeidle001', createdBy: ANA, agentId: scout.id, lastMessageAt: 1 }, WS, {
      members: [{ actor: ANA, readAt: 1 }, { actor: BEN, readAt: 1 }, { actor: CAL, readAt: 1 }, { actor: `agent:${scout.id}`, readAt: null }],
      messagesLoaded: true,
    })
    sessions.set(chat.id, chat)
    await sm.sendMessage(chat.id, 'standup at 10', undefined, undefined, { sender: BEN })
    expect(chat.isProcessing).toBe(false)
    expect(chat.turnAgentId).toBeUndefined()
    // unread for Ana and Cal, read for Ben (who wrote it); Ben's reply later is read by Ben, unread for the others again
    expect(events.filter((e) => e.type === 'complete').map((e) => [e.userIds[0], e.hasUnread])).toEqual([
      ['anaaaaaaaaaa', true], ['benbbbbbbbbb', false], ['calccccccccc', true],
    ])
    sm.setActiveViewingSession(chat.id, WS.id, 'anaaaaaaaaaa')
    await Bun.sleep(1)
    events.length = 0
    await sm.sendMessage(chat.id, 'see you there', undefined, undefined, { sender: ANA })
    expect(events.filter((e) => e.type === 'complete').map((e) => [e.userIds[0], e.hasUnread])).toEqual([
      ['anaaaaaaaaaa', false], ['benbbbbbbbbb', true], ['calccccccccc', true],
    ])
    const unread = (userId: string) => sm.getSessions(WS.id, userId).find((s) => s.id === chat.id)!.hasUnread
    expect([unread('anaaaaaaaaaa'), unread('benbbbbbbbbb'), unread('calccccccccc')]).toEqual([false, true, true])
  })
})

describe('the cursor: what each agent is given, and where it stands (metadata.agents)', () => {
  const scout = createAgent({ workspaceId: WS.id, title: 'Scout', provider: 'anthropic', createdBy: ANA })
  const writer = createAgent({ workspaceId: WS.id, title: 'Writer', provider: 'anthropic', createdBy: ANA })

  async function chatWithLog(id: string) {
    const { sm, sessions } = manager()
    const chat = createManagedSession({ id, createdBy: ANA, agentId: scout.id, lastMessageAt: 1 }, WS, {
      members: [{ actor: ANA, readAt: 1 }, { actor: BEN, readAt: 1 }, { actor: `agent:${scout.id}`, readAt: null }, { actor: `agent:${writer.id}`, readAt: null }],
      messagesLoaded: true,
    })
    chat.messages = [
      userMsg('u1', ANA, 'first question', 1),
      agentMsg('a1', scout.id, 'scout answer', 2),
      agentMsg('a2', writer.id, 'my earlier draft', 3),
      userMsg('u2', BEN, 'second thought', 4),
      userMsg('u3', BEN, `agent:${writer.id} what now`, 5),
    ]
    sessions.set(chat.id, chat)
    ;(sm as any).persistSession(chat)
    await sm.flushSession(chat.id)
    const position = (rowId: string) => getChatLog(WS.id, chat.id, 0).find((row) => row.id === rowId)!.position
    const prompt = (agentId: string) => {
      chat.turnAgentId = agentId
      return (sm as any).buildTurnPrompt(chat, `agent:${writer.id} what now`, { ids: ['u3'], author: BEN }) as Promise<string>
    }
    return { sm, chat, position, prompt }
  }

  it('after its cursor: every other author, attributed, its own replies left out; then the cursor moves to the newest row and is stored', async () => {
    const { sm, chat, position, prompt } = await chatWithLog('cursorchat01')
    chat.agents = { [writer.id]: { seen: position('u1'), sdkSessionId: 'pi-writer-1' } }
    expect(await prompt(writer.id)).toBe(`[Scout] scout answer\n\n[Ben] second thought\n\n[Ben] agent:${writer.id} what now`)
    expect(chat.agents[writer.id]).toEqual({ seen: position('u3'), sdkSessionId: 'pi-writer-1' })
    await sm.flushSession(chat.id)
    expect((getChat(WS.id, WS.rootPath, chat.id) as { agents?: unknown }).agents).toEqual({ [writer.id]: { seen: position('u3'), sdkSessionId: 'pi-writer-1' } })
    // nothing new since: only the message it answers
    expect(await prompt(writer.id)).toBe(`[Ben] agent:${writer.id} what now`)
  })

  it('without a cursor (an agent new to the chat): what came after its own last reply', async () => {
    const { chat, position, prompt } = await chatWithLog('cursorchat02')
    expect(await prompt(writer.id)).toBe(`[Ben] second thought\n\n[Ben] agent:${writer.id} what now`)
    expect(chat.agents?.[writer.id]?.seen).toBe(position('u3'))
  })
})

describe('direct messages', () => {
  saveConfig({ workspaces: [] } as never)
  const ws = addWorkspace({ name: 'DMs', rootPath: `/tmp/otto-mp-dm-${process.pid}` })
  for (const actor of [ANA, BEN, CAL]) createWorkspaceMember(ws.id, actor.slice(5), actor === ANA ? 'owner' : 'member')
  const dm = (sm: SessionManager, from: string, to: string) => sm.createSession(ws.id, { dmWith: to.slice(5) }, { createdBy: from, emitCreatedEvent: false })

  it('one per pair (dm_key, find-or-create from either side), with no agent; nobody leaves it or is removed from it', async () => {
    const { sm } = manager()
    const first = await dm(sm, ANA, BEN)
    expect(first).toMatchObject({ dmKey: `${ANA}|${BEN}`, members: [ANA, BEN] })
    expect(first.agentId).toBeUndefined()
    expect((await dm(sm, ANA, BEN)).id).toBe(first.id)
    expect((await dm(sm, BEN, ANA)).id).toBe(first.id)
    expect(await code(dm(sm, ANA, ANA))).toBe('invalid')
    expect(await code(sm.createSession(ws.id, { dmWith: 'notamember01' }, { createdBy: ANA }))).toBe('invalid')

    expect(await code(sm.leaveSession(first.id, 'benbbbbbbbbb'))).toBe('invalid')
    expect(await code(sm.removeSessionMember(first.id, 'anaaaaaaaaaa', BEN))).toBe('invalid')
    expect(sm.canSeeSession(first.id, 'benbbbbbbbbb')).toBe(true)
    expect(sm.canSeeSession(first.id, 'calccccccccc')).toBe(false)
  })

  it('a DM that gains a third person is a group: it loses its key, and the pair next gets a new DM', async () => {
    const { sm } = manager()
    const first = await dm(sm, ANA, CAL)
    await sm.addSessionMembers(first.id, 'anaaaaaaaaaa', [BEN])
    const group = sm.getSessions(ws.id, 'calccccccccc').find((s) => s.id === first.id)!
    expect(group.dmKey).toBeUndefined()
    expect(group.members).toEqual([ANA, CAL, BEN])
    expect(getChat(ws.id, ws.rootPath, first.id)?.dmKey).toBeUndefined()
    const next = await dm(sm, CAL, ANA)
    expect(next.id).not.toBe(first.id)
    expect(next.dmKey).toBe(`${ANA}|${CAL}`)
  })
})
