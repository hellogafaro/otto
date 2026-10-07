import { describe, expect, it } from 'bun:test'
import { AGENT_DEFAULT_NAME } from '@otto/shared/branding'
import type { Agent } from '../../../shared/types'
import { buildWorkspaceMembers } from '../use-workspace-members'

const agent = (id: string, title: string) => ({ id, title }) as Agent

describe('buildWorkspaceMembers', () => {
  it('lists the signed-in person and the default agent', () => {
    const { members, me, nameOf } = buildWorkspaceMembers({ id: 'abcdefghij12', name: 'Ada', email: 'ada@example.com' })
    expect(me).toBe('user:abcdefghij12')
    expect(members).toEqual([
      { actor: 'user:abcdefghij12', name: 'Ada', email: 'ada@example.com' },
      { actor: 'agent:default', name: AGENT_DEFAULT_NAME },
    ])
    expect(nameOf('user:abcdefghij12')).toBe('Ada')
    expect(nameOf('agent:default')).toBe(AGENT_DEFAULT_NAME)
  })

  it('has no person without a session (Electron): me is null, the agent stays', () => {
    const { members, me } = buildWorkspaceMembers({ name: 'Local', email: '' })
    expect(me).toBeNull()
    expect(members.map((member) => member.actor)).toEqual(['agent:default'])
    expect(buildWorkspaceMembers(null).me).toBeNull()
  })

  it('lists the server members, flags me from the server (Electron has no session) and keeps the agent last', () => {
    const rows = [
      { actor: 'user:owner1234567', userId: 'owner1234567', name: 'Olga', email: 'olga@example.com', role: 'owner' as const },
      { actor: 'user:local123456', userId: 'local123456', name: '', email: 'local@localhost', role: 'member' as const, me: true as const },
    ]
    const { members, me, nameOf } = buildWorkspaceMembers({ name: 'Local', email: '' }, rows)
    expect(me).toBe('user:local123456')
    expect(members).toEqual([
      { actor: 'user:owner1234567', name: 'Olga', email: 'olga@example.com', role: 'owner' },
      { actor: 'user:local123456', name: 'local@localhost', email: 'local@localhost', role: 'member' },
      { actor: 'agent:default', name: AGENT_DEFAULT_NAME },
    ])
    expect(nameOf('user:owner1234567')).toBe('Olga')
  })

  it('does not list the signed-in person twice once the members are loaded', () => {
    const rows = [{ actor: 'user:abcdefghij12', userId: 'abcdefghij12', name: 'Ada L', email: 'ada@example.com', role: 'owner' as const }]
    const { members, me } = buildWorkspaceMembers({ id: 'abcdefghij12', name: 'Ada', email: 'ada@example.com' }, rows)
    expect(me).toBe('user:abcdefghij12')
    expect(members.map((member) => member.name)).toEqual(['Ada L', AGENT_DEFAULT_NAME])
  })

  it('names an actor that is not a member', () => {
    const { nameOf } = buildWorkspaceMembers(null)
    expect(nameOf('agent:other')).toBe(AGENT_DEFAULT_NAME)
    expect(nameOf('user:gone')).toBe('gone')
  })

  it('names each agent by its own title, the legacy agent:default and an unknown agent by the default name', () => {
    const { members, nameOf } = buildWorkspaceMembers(null, [], [agent('aaaaaaaaaaaa', 'Researcher'), agent('bbbbbbbbbbbb', 'Writer')])
    expect(members.map((member) => member.actor)).toEqual(['agent:aaaaaaaaaaaa', 'agent:bbbbbbbbbbbb'])
    expect(nameOf('agent:aaaaaaaaaaaa')).toBe('Researcher')
    expect(nameOf('agent:bbbbbbbbbbbb')).toBe('Writer')
    expect(nameOf('agent:default')).toBe(AGENT_DEFAULT_NAME)
    expect(nameOf('agent:gone')).toBe(AGENT_DEFAULT_NAME)
  })
})
