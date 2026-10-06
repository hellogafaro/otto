/**
 * A document's page: its title in the title row and its markdown in the centerpiece, both edited in place and
 * saved by `useAutosave` (no Save button, 800 ms after the last change, on blur and on leaving, one "Saved"
 * toast). Every save carries the `updatedAt` it last saw; a save that finds the document changed elsewhere
 * (`conflict`) drops the draft and `onConflict` reloads it.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { PageCenterpiece } from '@workspace/ui/components/page'
import { PageScroll } from '@workspace/ui/components/page-frame'
import { TiptapMarkdownEditor } from '@otto/ui'
import { PageHeader } from '@/components/app-shell/page-header'
import { useAutosave } from '@/hooks/use-autosave'
import { useLibrary } from '@/hooks/use-library'
import type { LibraryItem, LibraryUpdate } from '../../../shared/types'
import { libraryErrorMessage } from './item-dialogs'
import { getDisplayTitle, toStoredTitle } from './library-items'

interface Draft {
  title: string
  content: string
}

export function DocumentEditor({
  item,
  content,
  actions,
  menu,
  onConflict,
}: {
  /** The document as it was read with `content` (a snapshot: a reload remounts the editor). */
  item: LibraryItem
  content: string
  /** The title row's actions (Details) and its More menu's items. */
  actions?: React.ReactNode
  menu?: React.ReactNode
  onConflict: () => void
}) {
  const { t } = useTranslation()
  const { updateLibraryItem } = useLibrary()
  const [initial] = React.useState<Draft>(() => ({ title: getDisplayTitle(item), content }))
  const saved = React.useRef({ ...initial, updatedAt: item.updatedAt })

  const save = async (draft: Draft) => {
    const patch: LibraryUpdate = { expectedUpdatedAt: saved.current.updatedAt }
    const title = draft.title.trim()
    if (title && title !== saved.current.title) patch.title = toStoredTitle(item, title)
    // The library refuses empty files: an emptied document is saved as one line break.
    if (draft.content !== saved.current.content) patch.content = { encoding: 'utf8', data: draft.content || '\n' }
    if (!patch.title && !patch.content) return
    const result = await updateLibraryItem(item.id, patch)
    if (!result.ok) throw Object.assign(new Error(libraryErrorMessage(t, result.code)), { code: result.code })
    saved.current = { title: title || saved.current.title, content: draft.content, updatedAt: result.value.updatedAt }
  }

  const { value, change, flush } = useAutosave(initial, save, { id: `library-${item.id}`, onConflict })
  // The title and the editor change one draft: each change starts from the latest one.
  const latestDraft = React.useRef(value)
  latestDraft.current = value
  const update = (patch: Partial<Draft>) => {
    latestDraft.current = { ...latestDraft.current, ...patch }
    change(latestDraft.current)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-8">
      <PageHeader
        title={
          <input
            aria-label={t('library.titlePlaceholder')}
            value={value.title}
            placeholder={t('library.titlePlaceholder')}
            onChange={(event) => update({ title: event.target.value })}
            onBlur={flush}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        }
        actions={actions}
        menu={menu}
      />
      <PageCenterpiece>
        <PageScroll className="px-5 py-5" onBlur={flush}>
          <TiptapMarkdownEditor
            content={initial.content}
            onUpdate={(markdown) => update({ content: markdown })}
            placeholder={t('library.documentPlaceholder')}
          />
        </PageScroll>
      </PageCenterpiece>
    </div>
  )
}
