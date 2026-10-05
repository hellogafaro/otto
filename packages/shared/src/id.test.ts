import { expect, test } from 'bun:test'
import { newId } from './id.ts'

test('newId is 12 lowercase letters and digits', () => {
  for (let i = 0; i < 100; i++) expect(newId()).toMatch(/^[0-9a-z]{12}$/)
})

test('newId does not repeat', () => {
  const ids = new Set(Array.from({ length: 10_000 }, () => newId()))
  expect(ids.size).toBe(10_000)
})
