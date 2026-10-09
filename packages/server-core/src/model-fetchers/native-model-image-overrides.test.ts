import { expect, it } from 'bun:test'
import type { ModelDefinition } from '@otto/shared/config/models'
import { retainModelImageOverrides } from './native-provider'

it('retains exact-ID explicit false/true image overrides without mutating catalogs or reviving absent models', () => {
  const models = [{ id: 'text-model', name: 'Text', supportsImages: true }, { id: 'image-model', name: 'Image' }, { id: 'new-model', supportsImages: true }] as ModelDefinition[]
  const saved = [{ id: 'text-model', supportsImages: false }, { id: 'image-model', supportsImages: true }, { id: 'removed-model', supportsImages: true }, 'legacy-string'] as (ModelDefinition | string)[]
  const merged = retainModelImageOverrides(models, saved)
  expect(merged.map((model) => model.id)).toEqual(['text-model', 'image-model', 'new-model'])
  expect(merged[0]).toMatchObject({ id: 'text-model', name: 'Text', supportsImages: false })
  expect(merged[1]).toMatchObject({ id: 'image-model', name: 'Image', supportsImages: true })
  expect(merged[2]).toEqual(models[2]!)
  expect(models[0]!.supportsImages).toBe(true)
  expect(saved[0]).toMatchObject({ supportsImages: false })
  expect(retainModelImageOverrides(models, null)).toEqual(models)
})
