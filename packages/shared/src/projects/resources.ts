import { MAX_RESOURCE_REF, MAX_RESOURCE_TITLE, MAX_RESOURCES } from './limits.ts'
import type { Resource } from './types.ts'

const TYPES = ['url', 'library', 'chat']

function isWebUrl(ref: string): boolean {
  try {
    const { protocol } = new URL(ref)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Checks the resources of a project or task (also what comes in over RPC) and returns them
 * trimmed, with unknown keys dropped. `fail` builds the error to throw, so each domain
 * reports its own typed error. A library or chat ref is not looked up: it may dangle.
 */
export function parseResources(value: unknown, fail: (message: string) => Error): Resource[] {
  if (!Array.isArray(value)) throw fail('resources must be an array')
  if (value.length > MAX_RESOURCES) throw fail(`At most ${MAX_RESOURCES} resources`)
  return value.map((entry, index) => {
    const { type, title, ref } = (entry ?? {}) as Record<string, unknown>
    const at = `resources[${index}]`
    if (typeof type !== 'string' || !TYPES.includes(type)) throw fail(`${at}.type must be url, library or chat`)
    if (typeof title !== 'string' || !title.trim() || title.trim().length > MAX_RESOURCE_TITLE) {
      throw fail(`${at}.title must be 1 to ${MAX_RESOURCE_TITLE} characters`)
    }
    if (typeof ref !== 'string' || !ref.trim() || ref.trim().length > MAX_RESOURCE_REF) {
      throw fail(`${at}.ref must be 1 to ${MAX_RESOURCE_REF} characters`)
    }
    if (type === 'url' && !isWebUrl(ref.trim())) throw fail(`${at}.ref must be an http or https URL`)
    return { type: type as Resource['type'], title: title.trim(), ref: ref.trim() }
  })
}
