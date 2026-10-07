import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_COMMANDS, formatAgentCommands, getAgentCommand } from '../agent-channels'
import { RPC_CHANNELS } from '../channels'

// The bundled `otto` skill's command list is generated from the agent channel table: this test fails when they
// differ, and `OTTO_WRITE_SKILL=1 bun test packages/shared/src/protocol/__tests__/agent-channels.test.ts` rewrites it.
const SKILL = join(import.meta.dir, '../../../../../apps/electron/resources/docs/otto.md')

const allChannels = (obj: object): string[] =>
  Object.values(obj).flatMap((value) => (typeof value === 'string' ? [value] : allChannels(value as object)))

describe('agent channel table', () => {
  it('names only RPC channels, each command once', () => {
    const known = new Set(allChannels(RPC_CHANNELS))
    expect(Object.values(AGENT_COMMANDS).filter((command) => !known.has(command.channel))).toEqual([])
  })

  it('declares optional arguments after the required ones', () => {
    for (const [name, command] of Object.entries(AGENT_COMMANDS)) {
      const firstOptional = command.args.findIndex((arg) => arg.startsWith('['))
      if (firstOptional >= 0) expect({ name, rest: command.args.slice(firstOptional).every((arg) => arg.startsWith('[')) }).toEqual({ name, rest: true })
    }
  })

  it('reads a two-word command first, then a one-word one', () => {
    expect(getAgentCommand(['tasks', 'get', 'abc'])).toMatchObject({ name: 'tasks get', args: ['abc'] })
    expect(getAgentCommand(['search', 'tasks', 'get'])).toMatchObject({ name: 'search', args: ['tasks', 'get'] })
    expect(getAgentCommand(['tasks'])).toBeNull()
    expect(getAgentCommand(['toString'])).toBeNull()
    expect(getAgentCommand([])).toBeNull()
  })

  it('lets exactly its read commands through the Explore-mode bash rules', () => {
    const rules = (JSON.parse(readFileSync(join(import.meta.dir, '../../../../../apps/electron/resources/permissions/default.json'), 'utf8')) as { allowedBashPatterns: { pattern: string }[] })
      .allowedBashPatterns.filter((rule) => rule.pattern.startsWith('^otto')).map((rule) => new RegExp(rule.pattern))
    const allowed = (command: string) => rules.some((rule) => rule.test(command))
    expect(allowed('otto') && allowed('otto help')).toBe(true)
    const wrong = Object.entries(AGENT_COMMANDS as Record<string, { read?: true }>).filter(([name, command]) => allowed(`otto ${name} x`) !== !!command.read)
    expect(wrong.map(([name]) => name)).toEqual([])
  })

  it('is what the otto skill lists', () => {
    const text = readFileSync(SKILL, 'utf8')
    const start = text.indexOf('-->', text.indexOf('<!-- commands:start')) + '-->\n'.length
    const end = text.indexOf('<!-- commands:end -->')
    const expected = `\`\`\`\n${formatAgentCommands()}\n\`\`\`\n`
    if (process.env.OTTO_WRITE_SKILL) writeFileSync(SKILL, text.slice(0, start) + expected + text.slice(end))
    else expect(text.slice(start, end)).toBe(expected)
  })
})
