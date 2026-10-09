import { useState } from 'react'
import type { Agent } from '../../../shared/types'
import type { ChatMember } from '@/hooks/use-chat-members'
import { ComposerFooter } from './composer-footer'

const agents = [
  { id: 'footer-agent-1', title: 'Research helper', avatar: '', isDefault: true },
  { id: 'footer-agent-2', title: 'Writing helper', avatar: '', isDefault: false },
] as Agent[]

const viewer: ChatMember = { actor: 'user:footer-viewer', name: 'Alex Rivera' }
const people: ChatMember[] = [
  { actor: 'user:footer-person-1', name: 'Casey Morgan' },
  { actor: 'user:footer-person-2', name: 'Sam Lee' },
  { actor: 'user:footer-person-3', name: 'Taylor Chen' },
]
const agentMembers = agents.map((agent): ChatMember => ({ actor: `agent:${agent.id}`, name: agent.title, agent }))

export function ComposerFooterFixture({ scenario = 'one-human', disabled = false }: {
  scenario?: 'one-human' | 'two-humans' | 'multi-overflow' | 'human-only' | 'linked-none'
  disabled?: boolean
}) {
  const [agent, setAgent] = useState(agents[0]!)
  const [person, setPerson] = useState<string | null>(null)
  const participants = scenario === 'linked-none' ? null
    : scenario === 'human-only' ? [viewer, ...people]
      : scenario === 'multi-overflow' ? [viewer, ...people, ...agentMembers]
        : scenario === 'two-humans' ? [viewer, people[0]!, agentMembers[0]!]
          : [viewer, agentMembers[0]!]
  return (
    <ComposerFooter
      disabled={disabled}
      participants={participants}
      picker={scenario === 'human-only' || scenario === 'multi-overflow' ? null : {
        agents,
        agent,
        people,
        person,
        onChange: (next) => { setAgent(next); setPerson(null) },
        onPickPerson: setPerson,
      }}
    />
  )
}
