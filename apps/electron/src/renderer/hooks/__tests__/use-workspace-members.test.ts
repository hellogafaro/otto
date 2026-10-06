import { describe, expect, it } from 'bun:test'
import { AGENT_DEFAULT_NAME } from '@otto/shared/branding'
import { buildWorkspaceMembers } from '../use-workspace-members'

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

  it('names an actor that is not a member', () => {
    const { nameOf } = buildWorkspaceMembers(null)
    expect(nameOf('agent:other')).toBe(AGENT_DEFAULT_NAME)
    expect(nameOf('user:gone')).toBe('gone')
  })
})
