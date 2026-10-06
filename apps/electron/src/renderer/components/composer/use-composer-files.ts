/**
 * The composer's files: added with +, a drop, a paste or a long pasted text, each read as soon as it is added
 * (base64, its text, a thumbnail) into the `FileAttachment` the send path already takes; the chat stores it at
 * send time (`file:storeAttachment`), as before. Kept in memory with the composer, so they stay while it grows
 * into the full one and across pages until they are sent or removed.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createId } from '@otto/shared/id'
import type { FileAttachment } from '../../../shared/types'

export interface ComposerFile {
  id: string
  name: string
  /** The MIME type ('' when unknown). */
  type: string
  size: number
  /** An object URL of an image, for its thumbnail. */
  url?: string
  state: 'uploading' | 'error' | 'done'
  attachment?: FileAttachment
  /** What it was read from, to read it again (Retry). */
  source?: File
}

/** The name of a pasted file without one: `pasted-image-3.png`, numbered after those already added. */
export function pastedName(prefix: 'image' | 'text', extension: string, names: string[]): string {
  const pattern = new RegExp(`^pasted-${prefix}-(\\d+)\\.`)
  const last = names.reduce((max, name) => Math.max(max, Number(name.match(pattern)?.[1] ?? 0)), 0)
  return `pasted-${prefix}-${last + 1}.${extension}`
}

function kindOf(file: File, name: string): FileAttachment['type'] {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type.includes('text') || /\.(txt|md|json|js|ts|tsx|py|css|html)$/i.test(name)) return 'text'
  if (file.type.includes('officedocument') || /\.(docx?|xlsx?|pptx?)$/i.test(name)) return 'office'
  return 'unknown'
}

/** A File as the attachment the send path takes: base64, its text when it is text, a thumbnail when one can be made. */
async function readAttachment(file: File, name: string): Promise<FileAttachment> {
  const api = window.electronAPI
  // The OS path of a picked or dropped file (none for a paste); the draft layer falls back to the content.
  const realPath = api?.getFilePath?.(file) ?? null
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  const base64 = btoa(binary)
  const type = kindOf(file, name)
  const mimeType = file.type || 'application/octet-stream'
  let thumbnailBase64: string | undefined
  try {
    thumbnailBase64 = (await api?.generateThumbnail?.(base64, mimeType)) || undefined
  } catch {
    // A thumbnail is optional.
  }
  return {
    type,
    path: realPath ?? name,
    name,
    mimeType,
    base64,
    text: type === 'text' ? new TextDecoder('utf-8').decode(bytes) : undefined,
    size: file.size,
    thumbnailBase64,
  }
}

export function useComposerFiles() {
  const [items, setItems] = useState<ComposerFile[]>([])
  const itemsRef = useRef(items)
  itemsRef.current = items

  const read = useCallback(async (item: ComposerFile) => {
    if (!item.source) return
    setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, state: 'uploading' } : entry)))
    try {
      const attachment = await readAttachment(item.source, item.name)
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, state: 'done', attachment } : entry)))
    } catch {
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, state: 'error' } : entry)))
    }
  }, [])

  const add = useCallback((list: FileList | File[]) => {
    const names = itemsRef.current.map((item) => item.name)
    const added = Array.from(list).map((file): ComposerFile => {
      // A pasted image comes without a real name.
      const unnamed = !file.name || file.name === 'blob' || /^image\.(png|jpe?g)$/.test(file.name)
      const name = unnamed ? pastedName('image', file.type.split('/')[1] || 'png', names) : file.name
      names.push(name)
      return {
        id: createId(),
        name,
        type: file.type,
        size: file.size,
        url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        state: 'uploading',
        source: file,
      }
    })
    setItems((current) => [...current, ...added])
    for (const item of added) void read(item)
    return added.length
  }, [read])

  /** A long paste becomes a text file instead of filling the box. */
  const addText = useCallback((text: string) => {
    const name = pastedName('text', 'txt', itemsRef.current.map((item) => item.name))
    const size = new Blob([text]).size
    const attachment: FileAttachment = { type: 'text', path: name, name, mimeType: 'text/plain', text, size }
    setItems((current) => [...current, { id: createId(), name, type: 'text/plain', size, state: 'done', attachment }])
  }, [])

  const remove = useCallback((id: string) => {
    setItems((current) => {
      const gone = current.find((item) => item.id === id)
      if (gone?.url) URL.revokeObjectURL(gone.url)
      return current.filter((item) => item.id !== id)
    })
  }, [])

  const retry = useCallback((id: string) => {
    const item = itemsRef.current.find((entry) => entry.id === id)
    if (item) void read(item)
  }, [read])

  const clear = useCallback(() => {
    for (const item of itemsRef.current) if (item.url) URL.revokeObjectURL(item.url)
    setItems([])
  }, [])

  useEffect(() => () => {
    for (const item of itemsRef.current) if (item.url) URL.revokeObjectURL(item.url)
  }, [])

  return {
    items,
    /** Every file is read: Send waits for this. */
    ready: items.every((item) => item.state === 'done'),
    attachments: items.flatMap((item) => (item.attachment ? [item.attachment] : [])),
    add,
    addText,
    remove,
    retry,
    clear,
  }
}
