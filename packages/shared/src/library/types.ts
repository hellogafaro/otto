/** What callers (including the renderer) see of the library; no database imports here. */

export type LibraryItemType = 'file' | 'document' | 'folder'
export type LibraryErrorCode = 'not_found' | 'conflict' | 'invalid' | 'too_large' | 'not_empty'

/** Timestamps are epoch milliseconds so an item survives JSON as is. */
export type LibraryItem = {
  id: string
  parentId: string | null
  type: LibraryItemType
  title: string
  mime: string | null
  size: number | null
  /** 'user:<id>' for a person, 'agent:<id>' for an agent. */
  createdBy: string
  createdAt: number
  updatedAt: number
}

/** Bytes on the wire: documents travel as text, everything else as base64. */
export type LibraryContent = { encoding: 'utf8' | 'base64'; data: string }

/** `parentId`: a folder id, null for the root, left out for everywhere. */
export type LibraryFilter = { parentId?: string | null; createdBy?: string; type?: LibraryItemType }

/** Replacing `content` needs `expectedUpdatedAt`, the `updatedAt` the caller last saw. */
export type LibraryUpdate = { title?: string; parentId?: string | null; content?: LibraryContent; expectedUpdatedAt?: number }
