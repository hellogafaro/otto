import matter from 'gray-matter'
import { marked } from 'marked'

export function splitSourceGuide(raw: string): { publicBody: string; frontmatter: string; cache: string } {
  let body = raw
  let frontmatter = ''
  const trimmed = raw.trimStart()
  if (/^---(?:[A-Za-z]|\s|$)/.test(trimmed)) {
    const prefix = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(trimmed)?.[0]
    if (!prefix) throw new Error('The source guide contains invalid private metadata.')
    try { matter(prefix) } catch { throw new Error('The source guide contains invalid private metadata.') }
    frontmatter = raw.slice(0, raw.length - trimmed.length) + prefix
    body = raw.slice(frontmatter.length)
  }
  const publicParts: string[] = []
  const privateParts: string[] = []
  const normalized = body.replace(/\r\n?/g, '\n')
  let cursor = 0
  let inCache = false
  for (const token of marked.lexer(normalized)) {
    const start = normalized.indexOf(token.raw, cursor)
    if (start < cursor) throw new Error('The source guide contains invalid private metadata.')
    const gap = normalized.slice(cursor, start)
    if (inCache) privateParts.push(gap)
    else publicParts.push(gap)
    if (token.type === 'heading' && token.depth <= 2) inCache = token.depth === 2 && token.text.trim().toLowerCase() === 'cache'
    if (inCache) privateParts.push(token.raw)
    else publicParts.push(token.raw)
    cursor = start + token.raw.length
  }
  if (inCache) privateParts.push(normalized.slice(cursor))
  else publicParts.push(normalized.slice(cursor))
  return { publicBody: publicParts.join(''), frontmatter, cache: privateParts.join('') }
}
