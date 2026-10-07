/** Multiplayer chats: an assistant turn belongs to one agent (`author`); another agent's row starts its own turn. */

import { describe, it, expect } from 'bun:test'
import type { Message } from '@otto/core'
import { groupMessagesByTurn, type AssistantTurn } from '../turn-utils'

const row = (id: string, timestamp: number, extra: Partial<Message>): Message =>
  ({ id, role: 'assistant', content: id, timestamp, ...extra }) as Message

describe('groupMessagesByTurn authors', () => {
  it('splits one run of rows into a turn per agent and keeps the author', () => {
    const turns = groupMessagesByTurn([
      { id: 'u1', role: 'user', content: 'hi both', timestamp: 1, sender: 'user:ada' } as Message,
      row('t1', 2, { role: 'tool', toolName: 'Read', toolUseId: 'x', toolStatus: 'completed', author: 'agent:writer' }),
      row('a1', 3, { author: 'agent:writer' }),
      row('a2', 4, { author: 'agent:editor' }),
    ], { isSessionProcessing: false })
    const assistants = turns.filter((turn): turn is AssistantTurn => turn.type === 'assistant')
    expect(assistants.map((turn) => [turn.author, turn.response?.text])).toEqual([['agent:writer', 'a1'], ['agent:editor', 'a2']])
  })

  it('leaves rows without an author in one turn (older chats)', () => {
    const turns = groupMessagesByTurn([
      row('i1', 1, { isIntermediate: true }),
      row('a1', 2, { author: 'agent:writer' }),
    ], { isSessionProcessing: false })
    expect(turns).toHaveLength(1)
  })
})
