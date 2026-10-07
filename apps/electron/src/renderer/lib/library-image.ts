/**
 * An image of the library as an object URL, read once through the library's read channel and kept for the page's life:
 * thumbnails, avatars and tiles repeat. `version` (the item's `updatedAt`) is a new key when its content is replaced.
 */

import { contentToBytes } from '@/pages/library/library-items'

const urls = new Map<string, Promise<string>>()

export function libraryImageUrl(id: string, version = 0): Promise<string> {
  const key = `${id}:${version}`
  let url = urls.get(key)
  if (!url) {
    url = window.electronAPI.readLibraryItem(id).then(({ item, content }) => URL.createObjectURL(new Blob([contentToBytes(content)], { type: item.mime ?? 'image/png' })))
    url.catch(() => urls.delete(key))
    urls.set(key, url)
  }
  return url
}
