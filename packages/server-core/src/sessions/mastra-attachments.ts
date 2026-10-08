import sharp from 'sharp'
import type { StoredAttachment } from '@otto/core/types'
import { getLibraryConversion, getLibraryItem, getLibraryItemPath, readLibraryContent } from '@otto/shared/library'
import { getWorkspaceByNameOrId } from '@otto/shared/config'

export type MastraInputFile = { data: string; mediaType: string; filename: string }
const office = /^(?:application\/(?:vnd\.(?:openxmlformats-officedocument\.|ms-)|msword))/i
const textMime = /^(?:text\/|application\/(?:json|[^;]+\+json)(?:;|$))/i

export function resolveMastraAttachmentReferences(workspaceId: string, attachments?: StoredAttachment[] | null): StoredAttachment[] {
  if (!attachments?.length) return []
  if (attachments.length > 4) throw new Error('Attach at most four files per message.')
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error('The attachment workspace is unavailable.')
  return attachments.map((ref) => {
    const item = getLibraryItem(workspaceId, ref.id)
    if (!item || item.type === 'folder') throw new Error('An attachment is missing or unavailable in this workspace. Reattach it.')
    if (ref.updatedAt !== undefined && ref.updatedAt !== item.updatedAt) throw new Error('The attached original changed. Reattach it.')
    const mimeType = item.mime ?? ''
    const type = office.test(mimeType) ? 'office' : mimeType === 'application/pdf' ? 'pdf' : mimeType.startsWith('image/') ? 'image' : textMime.test(mimeType) ? 'text' : 'unknown'
    const conversion = type === 'office' ? getLibraryConversion(workspaceId, item.id) : undefined
    if (ref.markdownId && ref.markdownId !== conversion?.id) throw new Error('The Office conversion is missing, changed or unrelated. Reattach the original.')
    return {
      id: item.id, type, name: item.title, mimeType, size: item.size ?? 0, updatedAt: item.updatedAt,
      storedPath: getLibraryItemPath(workspace.rootPath, item.id),
      ...(typeof ref.thumbnailBase64 === 'string' && ref.thumbnailBase64.length <= 100000 && /^[A-Za-z0-9+/=]+$/.test(ref.thumbnailBase64) ? { thumbnailBase64: ref.thumbnailBase64 } : {}),
      ...(conversion ? { markdownId: conversion.id, markdownPath: getLibraryItemPath(workspace.rootPath, conversion.id) } : {}),
    }
  })
}

export async function loadMastraAttachmentFiles(input: {
  workspaceId: string
  attachments: StoredAttachment[]
  signal: AbortSignal
  assertAccess: () => void
  supportsImages: boolean
  budget: { bytes: number; tokens: number }
}): Promise<MastraInputFile[]> {
  input.assertAccess()
  input.signal.throwIfAborted()
  const budget = { ...input.budget }
  const files: MastraInputFile[] = []
  const references = resolveMastraAttachmentReferences(input.workspaceId, input.attachments)
  for (const ref of references) {
    input.assertAccess()
    input.signal.throwIfAborted()
    const original = getLibraryItem(input.workspaceId, ref.id)!
    if (ref.type === 'unknown') throw new Error('This file type is not supported by native model input.')
    if (ref.type === 'office' && !ref.markdownId) throw new Error('This Office attachment has no verified conversion. Reattach the original.')
    if (ref.type === 'image' && (!input.supportsImages || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(ref.mimeType))) throw new Error('This image type or selected model does not support image input.')
    if (ref.type === 'pdf' && !input.supportsImages) throw new Error('The selected text-only model cannot inspect PDF pages.')
    const id = ref.markdownId ?? ref.id
    const item = getLibraryItem(input.workspaceId, id)!
    const maxBytes = ref.type === 'text' || ref.type === 'office' ? 32768 : 5 * 1024 * 1024
    const bytes = await readLibraryContent(input.workspaceId, id, { maxBytes, signal: input.signal })
    input.assertAccess()
    const current = getLibraryItem(input.workspaceId, original.id)
    if (!current || current.updatedAt !== original.updatedAt || (ref.markdownId && getLibraryConversion(input.workspaceId, ref.id)?.id !== ref.markdownId)) throw new Error('The attachment changed while preparing model input. Reattach it.')
    let data: string
    let mediaType = ref.mimeType
    let tokens = 0
    if (ref.type === 'text' || ref.type === 'office') {
      data = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (data.includes('\u0000')) throw new Error('This attachment is not valid text.')
      mediaType = 'text/plain'
      tokens = bytes.byteLength
    } else {
      if (ref.type === 'image') {
        const metadata = await sharp(bytes, { limitInputPixels: 2048 * 2048 }).metadata()
        if (!metadata.width || !metadata.height || metadata.width > 2048 || metadata.height > 2048 || (metadata.pages ?? 1) > 1) throw new Error('Use a single image no larger than 2048 pixels per edge.')
        const types: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
        const expected = types[metadata.format ?? '']
        if (expected !== ref.mimeType) throw new Error('The image bytes do not match their stored type.')
        tokens = 8192
      } else {
        if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('The PDF bytes do not match their stored type.')
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
        const task = getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, disableFontFace: true })
        const abort = () => { void task.destroy().catch(() => {}) }
        input.signal.addEventListener('abort', abort, { once: true })
        try {
          input.signal.throwIfAborted()
          const document = await task.promise
          if (document.numPages > 4) throw new Error('Native PDF input is limited to four pages. Attach a smaller PDF.')
          tokens = document.numPages * 8192
          for (let page = 1; page <= document.numPages; page++) {
            input.assertAccess()
            const content = await (await document.getPage(page)).getTextContent()
            const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ')
            tokens += Buffer.byteLength(text)
          }
        } finally {
          input.signal.removeEventListener('abort', abort)
          await task.destroy()
        }
      }
      data = `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`
    }
    input.assertAccess()
    input.signal.throwIfAborted()
    if (getLibraryItem(input.workspaceId, original.id)?.updatedAt !== original.updatedAt || getLibraryItem(input.workspaceId, item.id)?.updatedAt !== item.updatedAt) throw new Error('The attachment changed while preparing model input.')
    budget.bytes += bytes.byteLength
    budget.tokens += tokens
    if (budget.bytes > 8 * 1024 * 1024 || budget.tokens > 32768) throw new Error('Attachments exceed this turn’s 8 MiB or conservative 32K input-token allowance. Start a new chat or attach smaller files.')
    files.push({ data, mediaType, filename: ref.type === 'office' ? item.title : ref.name })
  }
  Object.assign(input.budget, budget)
  return files
}
