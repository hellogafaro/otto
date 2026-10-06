import { describe, expect, it } from 'bun:test'
import { getMentionCandidates, getMentionQuery, insertMention } from '../comment-mentions'

describe('getMentionQuery', () => {
  it('finds the @query the caret ends', () => {
    expect(getMentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(getMentionQuery('Hi @ma', 6)).toEqual({ start: 3, query: 'ma' })
    expect(getMentionQuery('Hi @ma there', 6)).toEqual({ start: 3, query: 'ma' })
  })

  it('ignores emails, spaces after the query and a caret elsewhere', () => {
    expect(getMentionQuery('mail@ex', 7)).toBeNull()
    expect(getMentionQuery('@ma ', 4)).toBeNull()
    expect(getMentionQuery('@ma', 0)).toBeNull()
  })
})

describe('insertMention', () => {
  it('replaces the @query with the token and one space, the caret after it', () => {
    expect(insertMention('Hi @ma', { start: 3, query: 'ma' }, 'user:abcdefghijk1')).toEqual({ text: 'Hi user:abcdefghijk1 ', caret: 21 })
    expect(insertMention('@ma there', { start: 0, query: 'ma' }, 'user:abcdefghijk1')).toEqual({ text: 'user:abcdefghijk1 there', caret: 18 })
  })
})

describe('getMentionCandidates', () => {
  const members = [
    { actor: 'user:a', name: 'María López', email: 'maria@example.com' },
    { actor: 'user:b', name: 'Bob', email: 'bob@example.com' },
    { actor: 'agent:default', name: 'Agent' },
  ]

  it('lists people only, matching a word start of the name or email, accents ignored', () => {
    expect(getMentionCandidates(members, '').map((m) => m.actor)).toEqual(['user:a', 'user:b'])
    expect(getMentionCandidates(members, 'lop').map((m) => m.actor)).toEqual(['user:a'])
    expect(getMentionCandidates(members, 'maria').map((m) => m.actor)).toEqual(['user:a'])
    expect(getMentionCandidates(members, 'ob')).toEqual([])
    expect(getMentionCandidates(members, 'ag')).toEqual([])
    expect(getMentionCandidates(members, '', 1)).toHaveLength(1)
  })
})
