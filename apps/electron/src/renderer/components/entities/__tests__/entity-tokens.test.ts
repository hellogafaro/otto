import { describe, expect, it } from 'bun:test'
import { describeEntity, parseEntity, plainEntityText, splitEntityTokens, toEntityMarkdown, type EntityLists } from '../entity-tokens'

const U = 'abcdefghijk1'
const T = 'task00000001'

const lists: EntityLists = {
  members: [{ actor: `user:${U}`, name: 'Maria', email: 'maria@example.com' }],
  tasks: [{ id: T, title: 'Fix login' }],
  projects: [],
  library: [{ id: 'doc000000001', type: 'document', title: 'Plan.md' }],
  agents: [{ id: 'agent0000001', title: 'Otto', avatar: '' }],
}

describe('splitEntityTokens', () => {
  it('splits text and tokens in order, leaving lookalikes alone', () => {
    expect(splitEntityTokens(`Hi user:${U}, see task:${T}. xuser:${U} task:short`)).toEqual([
      { text: 'Hi ' },
      { entity: `user:${U}` },
      { text: ', see ' },
      { entity: `task:${T}` },
      { text: `. xuser:${U} task:short` },
    ])
  })

  it('keeps tokens in code as text', () => {
    expect(splitEntityTokens(`\`user:${U}\` and\n\`\`\`\ntask:${T}\n\`\`\`\nuser:${U}`)).toEqual([
      { text: `\`user:${U}\` and\n\`\`\`\ntask:${T}\n\`\`\`\n` },
      { entity: `user:${U}` },
    ])
  })

  it('marks tokens as entity spans for the markdown renderer', () => {
    expect(toEntityMarkdown(`**Hey** user:${U}`)).toBe(`**Hey** <span data-entity="user:${U}"></span>`)
    expect(toEntityMarkdown('nothing here')).toBe('nothing here')
  })
})

describe('describeEntity', () => {
  it('reads live titles and routes by type', () => {
    expect(parseEntity(`task:${T}`)).toEqual({ type: 'task', id: T })
    expect(parseEntity(`task:${T}x`)).toBeNull()
    expect(describeEntity(`user:${U}`, lists)).toMatchObject({ title: 'Maria', missing: false, route: null })
    expect(describeEntity(`task:${T}`, lists)).toMatchObject({ title: 'Fix login', route: `tasks/task/${T}` })
    expect(describeEntity('library:doc000000001', lists)).toMatchObject({ title: 'Plan', route: 'library/item/doc000000001' })
    expect(describeEntity('agent:agent0000001', lists)).toMatchObject({ type: 'agent', title: 'Otto', route: 'agents/agent/agent0000001' })
    expect(describeEntity('agent:agent0000002', lists)).toMatchObject({ title: null, missing: true })
  })

  it('is missing once its list has loaded without it, unknown while it loads', () => {
    expect(describeEntity('project:proj00000001', lists)).toMatchObject({ title: null, missing: true })
    expect(describeEntity('project:proj00000001', { ...lists, projects: null })).toMatchObject({ title: null, missing: false })
    expect(describeEntity('comment:comm00000001', lists)).toMatchObject({ route: null, missing: false })
  })

  it('makes a one-line excerpt with labels for tokens', () => {
    expect(plainEntityText(`Can you\n\ncheck user:${U}?`, (entity) => `@${entity.slice(5, 8)}`)).toBe('Can you check @abc?')
    expect(plainEntityText('# Title\n> It fails on **Safari** with `code`', (entity) => entity)).toBe('Title It fails on Safari with code')
  })
})
