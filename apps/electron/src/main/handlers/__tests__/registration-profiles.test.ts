import { beforeEach, describe, expect, it } from 'bun:test'
import type { RpcServer } from '@otto/server-core/transport'
import { createMockDeps } from './electron-mock'

const registeredChannels: string[] = []

function createMockServer(): RpcServer {
  return {
    handle(channel: string, _handler: unknown) {
      registeredChannels.push(channel)
    },
    push() {},
    async invokeClient() {},
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
}

async function getExpectedCoreChannels(): Promise<Set<string>> {
  // Core handler channels (now in server-core)
  const [
    auth,
    automations,
    files,
    labels,
    library,
    llm,
    oauth,
    pages,
    projects,
    tasks,
    sessions,
    settings,
    skills,
    sources,
    statuses,
    system,
    workspace,
    workspacesMembers,
    onboarding,
    resources,
    transfer,
    decisions,
  ] = await Promise.all([
    import('@otto/server-core/handlers/rpc/auth'),
    import('@otto/server-core/handlers/rpc/automations'),
    import('@otto/server-core/handlers/rpc/files'),
    import('@otto/server-core/handlers/rpc/labels'),
    import('@otto/server-core/handlers/rpc/library'),
    import('@otto/server-core/handlers/rpc/llm-connections'),
    import('@otto/server-core/handlers/rpc/oauth'),
    import('@otto/server-core/handlers/rpc/pages'),
    import('@otto/server-core/handlers/rpc/projects'),
    import('@otto/server-core/handlers/rpc/tasks'),
    import('@otto/server-core/handlers/rpc/sessions'),
    import('@otto/server-core/handlers/rpc/settings'),
    import('@otto/server-core/handlers/rpc/skills'),
    import('@otto/server-core/handlers/rpc/sources'),
    import('@otto/server-core/handlers/rpc/statuses'),
    import('@otto/server-core/handlers/rpc/system'),
    import('@otto/server-core/handlers/rpc/workspace'),
    import('@otto/server-core/handlers/rpc/workspaces-members'),
    import('@otto/server-core/handlers/rpc/onboarding'),
    import('@otto/server-core/handlers/rpc/resources'),
    import('@otto/server-core/handlers/rpc/transfer'),
    import('@otto/server-core/handlers/rpc/decisions'),
  ])

  return new Set([
    ...auth.HANDLED_CHANNELS,
    ...automations.HANDLED_CHANNELS,
    ...files.HANDLED_CHANNELS,
    ...labels.HANDLED_CHANNELS,
    ...library.HANDLED_CHANNELS,
    ...llm.HANDLED_CHANNELS,
    ...oauth.HANDLED_CHANNELS,
    ...projects.HANDLED_CHANNELS,
    ...tasks.HANDLED_CHANNELS,
    ...pages.HANDLED_CHANNELS,
    ...sessions.HANDLED_CHANNELS,
    ...settings.HANDLED_CHANNELS,
    ...skills.HANDLED_CHANNELS,
    ...sources.HANDLED_CHANNELS,
    ...statuses.HANDLED_CHANNELS,
    ...system.CORE_HANDLED_CHANNELS,
    ...workspace.CORE_HANDLED_CHANNELS,
    ...workspacesMembers.HANDLED_CHANNELS,
    ...onboarding.HANDLED_CHANNELS,
    ...resources.HANDLED_CHANNELS,
    ...transfer.HANDLED_CHANNELS,
    ...decisions.HANDLED_CHANNELS,
  ])
}

async function getExpectedGuiChannels(): Promise<Set<string>> {
  const [browser, system, workspace, settings] = await Promise.all([
    import('../browser'),
    import('../system'),
    import('../workspace'),
    import('../settings'),
  ])

  return new Set([
    ...browser.HANDLED_CHANNELS,
    ...system.GUI_HANDLED_CHANNELS,
    ...workspace.GUI_HANDLED_CHANNELS,
    ...settings.GUI_HANDLED_CHANNELS,
  ])
}

describe('RPC handler profile registration', () => {
  beforeEach(() => {
    registeredChannels.length = 0
  })

  it('registerCoreRpcHandlers registers only core channels', async () => {
    const expected = await getExpectedCoreChannels()
    const { registerCoreRpcHandlers } = await import('../index')

    registerCoreRpcHandlers(createMockServer(), createMockDeps())

    const actual = new Set(registeredChannels.filter(ch => ch.includes(':')))
    expect([...expected].filter(ch => !actual.has(ch))).toEqual([])
    expect([...actual].filter(ch => !expected.has(ch))).toEqual([])
  })

  it('registerGuiRpcHandlers registers only gui channels', async () => {
    const expected = await getExpectedGuiChannels()
    const { registerGuiRpcHandlers } = await import('../index')

    registerGuiRpcHandlers(createMockServer(), createMockDeps())

    const actual = new Set(registeredChannels.filter(ch => ch.includes(':')))
    expect([...expected].filter(ch => !actual.has(ch))).toEqual([])
    expect([...actual].filter(ch => !expected.has(ch))).toEqual([])
  })
})
