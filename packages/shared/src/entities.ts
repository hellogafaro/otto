/**
 * An entity is what something is about or attached to: a typed reference '<type>:<id>', the same string
 * shape as an actor. Comments and notifications take any type in `ENTITY_TYPES`, so a new type is one
 * line here and no schema change. 'comment' is an entity too (a notification of a mention points at
 * its comment; replies later).
 */
export const ENTITY_TYPES = ['task', 'project', 'comment']

/**
 * A reference written in text (a comment's content): the bare token `<type>:<id>`, stored as typed so a
 * rename shows everywhere. The server finds mentions (`user:`) with it, the renderer draws every match
 * as a chip. Global: use it with `matchAll` or `replace`, never `test` or `exec`.
 */
export const ENTITY_TOKEN = /\b(user|task|project|library|agent|comment):([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9]{12})\b/g

export const isEntity = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z]+:(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9]{12})$/.test(value) && ENTITY_TYPES.includes(value.slice(0, value.indexOf(':')))
