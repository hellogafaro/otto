import { describe, expect, it } from 'bun:test'
import type { LibraryItem } from '../../../../shared/types'
import {
  AGENTS_FILTER,
  canMoveInto,
  formatSize,
  getDisplayTitle,
  getExtension,
  getFolderPath,
  getFolderRows,
  getPreviewKind,
  getVisibleItems,
  MAX_PREVIEW_BYTES,
  toCodeBlock,
  toStoredTitle,
} from '../library-items'

let clock = 0
function item(id: string, type: LibraryItem['type'], folderId: string | null = null, extra: Partial<LibraryItem> = {}): LibraryItem {
  clock++
  return { id, type, folderId, title: id, mime: null, size: type === 'folder' ? null : 10, createdBy: 'user:aaaaaaaaaaaa', createdAt: clock, updatedAt: clock, ...extra }
}

/** A chain of folders f1 > f2 > ... > fn in the root. */
function chain(n: number): LibraryItem[] {
  return Array.from({ length: n }, (_, i) => item(`f${i + 1}`, 'folder', i === 0 ? null : `f${i}`))
}

describe('getVisibleItems', () => {
  const items = [
    item('doc', 'document'),
    item('file', 'file'),
    item('folder', 'folder'),
    item('newer-file', 'file'),
    item('inside', 'file', 'folder'),
    item('agent-file', 'file', null, { createdBy: 'agent:default' }),
  ]

  it('shows the open folder: folders first, then files, then documents, newest first', () => {
    expect(getVisibleItems(items, { tab: 'all', folder: null }).map((i) => i.id)).toEqual(['folder', 'agent-file', 'newer-file', 'file', 'doc'])
    expect(getVisibleItems(items, { tab: 'all', folder: 'folder' }).map((i) => i.id)).toEqual(['inside'])
  })

  it('keeps folders in every tab', () => {
    expect(getVisibleItems(items, { tab: 'documents', folder: null }).map((i) => i.id)).toEqual(['folder', 'doc'])
    expect(getVisibleItems(items, { tab: 'files', folder: null }).map((i) => i.id)).toEqual(['folder', 'agent-file', 'newer-file', 'file'])
  })

  it('filters by one creator, or by any agent', () => {
    expect(getVisibleItems(items, { tab: 'all', folder: null, createdBy: AGENTS_FILTER }).map((i) => i.id)).toEqual(['agent-file'])
    expect(getVisibleItems(items, { tab: 'all', folder: null, createdBy: 'user:aaaaaaaaaaaa' }).map((i) => i.id)).not.toContain('agent-file')
  })
})

describe('folder paths', () => {
  it('derives the path from the root down', () => {
    const items = chain(3)
    expect(getFolderPath(items, 'f3').map((f) => f.id)).toEqual(['f1', 'f2', 'f3'])
    expect(getFolderPath(items, null)).toEqual([])
    expect(getFolderPath(items, 'missing')).toEqual([])
  })

  it('lists folders in tree order with their depth', () => {
    const items = [...chain(2), item('a', 'folder', null, { title: 'A' })]
    expect(getFolderRows(items).map(({ folder, depth }) => `${folder.id}:${depth}`)).toEqual(['a:1', 'f1:1', 'f2:2'])
  })

  it('never moves a folder into its own tree or deeper than eight levels', () => {
    const items = [...chain(8), item('g1', 'folder'), item('g2', 'folder', 'g1'), item('x', 'file')]
    const f1 = items[0]!
    expect(canMoveInto(items, f1, 'f3')).toBe(false)
    expect(canMoveInto(items, f1, null)).toBe(true)
    const g1 = items.find((i) => i.id === 'g1')!
    expect(canMoveInto(items, g1, 'f6')).toBe(true) // 6 + 2 levels
    expect(canMoveInto(items, g1, 'f7')).toBe(false) // 7 + 2 levels
    expect(canMoveInto(items, items.find((i) => i.id === 'x')!, 'f8')).toBe(true)
  })
})

describe('names and types', () => {
  it('reads the extension in capitals', () => {
    expect(getExtension('Pitch deck v3.pdf')).toBe('PDF')
    expect(getExtension('README')).toBe('')
    expect(getExtension('.env')).toBe('')
  })

  it('shows and stores a document without and with .md', () => {
    const doc = { type: 'document' as const, title: 'Launch plan.md' }
    expect(getDisplayTitle(doc)).toBe('Launch plan')
    expect(toStoredTitle(doc, 'Launch plan v2')).toBe('Launch plan v2.md')
    expect(toStoredTitle({ type: 'file', title: 'a.md' }, 'b')).toBe('b')
  })

  it('picks the preview by type, none over 8 MiB or for unknown types', () => {
    const preview = (title: string, mime: string | null, size = 10) => getPreviewKind({ title, mime, size })
    expect(preview('a.png', 'image/png')).toBe('image')
    expect(preview('a.mp4', 'video/mp4')).toBe('video')
    expect(preview('a.mp3', 'audio/mpeg')).toBe('audio')
    expect(preview('a.pdf', 'application/pdf')).toBe('pdf')
    expect(preview('a.html', 'text/html; charset=utf-8')).toBe('html')
    expect(preview('notes.md', 'application/octet-stream')).toBe('markdown')
    expect(preview('a.json', 'application/json')).toBe('text')
    expect(preview('a.txt', 'text/plain')).toBe('text')
    expect(preview('a.bin', 'application/octet-stream')).toBe('none')
    expect(preview('a', null)).toBe('none')
    expect(preview('big.png', 'image/png', MAX_PREVIEW_BYTES + 1)).toBe('none')
  })

  it('fences text longer than any backtick run in it', () => {
    expect(toCodeBlock('a')).toBe('```\na\n```')
    expect(toCodeBlock('x ```` y')).toBe('`````\nx ```` y\n`````')
  })

  it('formats sizes base 1024', () => {
    expect(formatSize(512, 'en')).toBe('512 bytes')
    expect(formatSize(1536, 'en')).toBe('1.5 kB')
    expect(formatSize(8 * 1024 * 1024, 'en')).toBe('8 MB')
  })
})
