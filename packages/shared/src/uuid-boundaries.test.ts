import { expect, test } from 'bun:test'
import { isActor } from './actors.ts'
import { ENTITY_TOKEN, isEntity } from './entities.ts'
import { AVATAR_REF } from './agents/types.ts'
import { assertKey } from './library/file-store.ts'

test('UUID boundaries preserve full typed references and refuse traversal', () => {
  const id = crypto.randomUUID()
  expect(isActor(`user:${id}`)).toBe(true)
  expect(isActor(`agent:${id}`)).toBe(true)
  expect(isEntity(`task:${id}`)).toBe(true)
  expect(
    [...`task:${id} and user:${id}`.matchAll(ENTITY_TOKEN)].map(
      (match) => match[2],
    ),
  ).toEqual([id, id])
  expect(AVATAR_REF.test(`library:${id}`)).toBe(true)
  expect(assertKey(id)).toBe(id)
  expect(() => assertKey('../' + id)).toThrow()
  expect(isEntity('task:invalid-path')).toBe(false)
})
