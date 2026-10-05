import { expect, test } from 'bun:test'
import { createId } from './id.ts'

test('createId is 12 lowercase letters and digits', () => {
  for (let i = 0; i < 100; i++) expect(createId()).toMatch(/^[0-9a-z]{12}$/)
})

test('createId does not repeat', () => {
  const ids = new Set(Array.from({ length: 10_000 }, () => createId()))
  expect(ids.size).toBe(10_000)
})
