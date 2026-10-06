/**
 * The Library page's pure logic: which items a tab, folder and creator show, folder paths (the
 * library is loaded whole, so paths are derived here, not fetched), how a file previews, and the
 * small conversions for upload and download. No React.
 */

import { MAX_FOLDER_DEPTH } from '@otto/shared/library/limits'
import type { LibraryTab } from '../../../shared/section-search'
import type { LibraryContent, LibraryItem } from '../../../shared/types'

export { MAX_FILE_BYTES, MAX_FOLDER_DEPTH } from '@otto/shared/library/limits'

/** Bigger files are not previewed (v1's cap): they download instead. */
export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024

/** The `createdBy` filter value for "any agent"; anything else is one actor (`user:<id>`). */
export const AGENTS_FILTER = 'agent'

export interface LibraryView {
  tab: LibraryTab
  /** The open folder; null is the root. */
  folder: string | null
  createdBy?: string
}

const KIND_ORDER = { folder: 0, file: 1, document: 2 } as const

export function matchesCreatedBy(item: LibraryItem, createdBy: string | undefined): boolean {
  if (!createdBy) return true
  return createdBy === AGENTS_FILTER ? item.createdBy.startsWith('agent:') : item.createdBy === createdBy
}

/** What the gallery shows: the open folder's items of the tab and creator, folders first, then files, then documents, newest first. */
export function getVisibleItems(items: LibraryItem[], view: LibraryView): LibraryItem[] {
  return items
    .filter((item) => (item.folderId ?? null) === view.folder)
    .filter((item) => view.tab === 'all' || item.type === 'folder' || item.type === (view.tab === 'files' ? 'file' : 'document'))
    .filter((item) => matchesCreatedBy(item, view.createdBy))
    .sort((a, b) => KIND_ORDER[a.type] - KIND_ORDER[b.type] || b.updatedAt - a.updatedAt)
}

/** The folders from the root down to `folderId` (itself last); empty for the root or a folder that is not there. */
export function getFolderPath(items: LibraryItem[], folderId: string | null): LibraryItem[] {
  const byId = new Map(items.filter((item) => item.type === 'folder').map((item) => [item.id, item]))
  const path: LibraryItem[] = []
  for (let id = folderId; id !== null && path.length <= MAX_FOLDER_DEPTH; ) {
    const folder = byId.get(id)
    if (!folder) return []
    path.unshift(folder)
    id = folder.folderId
  }
  return path
}

/** The ids of a folder and every folder under it (where a folder cannot move). */
export function getFolderTree(items: LibraryItem[], folderId: string): Set<string> {
  const tree = new Set([folderId])
  for (let grew = true; grew; ) {
    grew = false
    for (const item of items) {
      if (item.type === 'folder' && item.folderId && tree.has(item.folderId) && !tree.has(item.id)) {
        tree.add(item.id)
        grew = true
      }
    }
  }
  return tree
}

/** Every folder in tree order (each under its parent, siblings by title) with its depth (1 in the root), for a folder picker. */
export function getFolderRows(items: LibraryItem[]): { folder: LibraryItem; depth: number }[] {
  const folders = items.filter((item) => item.type === 'folder').sort((a, b) => a.title.localeCompare(b.title))
  const rows: { folder: LibraryItem; depth: number }[] = []
  const visit = (parent: string | null, depth: number) => {
    if (depth > MAX_FOLDER_DEPTH) return
    for (const folder of folders.filter((item) => (item.folderId ?? null) === parent)) {
      rows.push({ folder, depth })
      visit(folder.id, depth + 1)
    }
  }
  visit(null, 1)
  return rows
}

/** How many levels a folder's tree has (1 for a folder with no folders in it). */
export function getFolderHeight(items: LibraryItem[], folderId: string): number {
  const below = items.filter((item) => item.type === 'folder' && item.folderId === folderId)
  return 1 + Math.max(0, ...below.map((folder) => getFolderHeight(items, folder.id)))
}

/** Whether `item` may go into `target` (null: the root): not into itself or its own tree, and folders nest at most 8 levels. */
export function canMoveInto(items: LibraryItem[], item: LibraryItem, target: string | null): boolean {
  if (item.type !== 'folder') return true
  if (target !== null && getFolderTree(items, item.id).has(target)) return false
  return getFolderPath(items, target).length + getFolderHeight(items, item.id) <= MAX_FOLDER_DEPTH
}

/** A file's extension in capitals ("PDF"), empty when its name has none. */
export function getExtension(title: string): string {
  const dot = title.lastIndexOf('.')
  return dot > 0 && dot < title.length - 1 ? title.slice(dot + 1).toUpperCase() : ''
}

const MARKDOWN_NAME = /\.md$/i

/** What a document is called on screen: its file name without `.md`. */
export function getDisplayTitle(item: Pick<LibraryItem, 'type' | 'title'>): string {
  return item.type === 'document' ? item.title.replace(MARKDOWN_NAME, '') || item.title : item.title
}

/** The stored title for a typed name: a document keeps its `.md`. */
export function toStoredTitle(item: Pick<LibraryItem, 'type' | 'title'>, name: string): string {
  const trimmed = name.trim()
  return item.type === 'document' && MARKDOWN_NAME.test(item.title) && !MARKDOWN_NAME.test(trimmed) ? `${trimmed}.md` : trimmed
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'html' | 'markdown' | 'text' | 'none'

const TEXT_MIMES = ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml', 'application/toml', 'application/javascript', 'application/x-sh']

/** How a file shows: in the browser's own viewers, sandboxed HTML, rendered text, or not at all (over 8 MiB or an unknown type: Download). */
export function getPreviewKind(item: Pick<LibraryItem, 'title' | 'mime' | 'size'>): PreviewKind {
  if ((item.size ?? 0) > MAX_PREVIEW_BYTES) return 'none'
  const mime = (item.mime ?? '').split(';')[0]!.trim().toLowerCase()
  if (mime === 'text/markdown' || MARKDOWN_NAME.test(item.title)) return 'markdown'
  if (mime === 'text/html') return 'html'
  if (mime === 'application/pdf') return 'pdf'
  const family = mime.split('/')[0]
  if (family === 'image' || family === 'video' || family === 'audio') return family
  if (family === 'text' || TEXT_MIMES.includes(mime)) return 'text'
  return 'none'
}

/** Plain text as a fenced code block for the markdown renderer, the fence longer than any run of backticks in it. */
export function toCodeBlock(text: string): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}\n${text}\n${fence}`
}

/** A size in the locale's words ("1.5 MB"), base 1024 like the 8 MiB cap. */
export function formatSize(bytes: number, locale?: string): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  // Bytes spelled out ("512 bytes": the short form reads "512 byte"), the rest short ("1.5 MB").
  return new Intl.NumberFormat(locale, { style: 'unit', unit: units[unit], unitDisplay: unit === 0 ? 'long' : 'short', maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)
}

export function contentToBytes(content: LibraryContent): Uint8Array<ArrayBuffer> {
  if (content.encoding === 'utf8') return new TextEncoder().encode(content.data)
  const binary = atob(content.data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function contentToText(content: LibraryContent): string {
  return content.encoding === 'utf8' ? content.data : new TextDecoder().decode(contentToBytes(content))
}

/** A picked file as base64 for `createLibraryItem` (no streamed upload yet: docs/library.md). */
export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Saves an item's bytes as a file on the person's machine. */
export async function downloadLibraryItem(item: LibraryItem): Promise<void> {
  const { content } = await window.electronAPI.readLibraryItem(item.id)
  const url = URL.createObjectURL(new Blob([contentToBytes(content)], { type: item.mime ?? 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = item.title
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
