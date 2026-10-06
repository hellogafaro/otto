/**
 * New link: a dialog that makes one `Resource` (a web link, a library item or a chat) and hands it to `onAdd`.
 * The kind is a compact `Tabs`; a web link takes a URL and an optional title (the host when left empty), a
 * library item or a chat is picked from a searchable `Combobox` and keeps its title. The caller saves it.
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Button } from '@workspace/ui/components/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@workspace/ui/components/combobox'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { MAX_RESOURCE_TITLE } from '@otto/shared/projects/limits'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useAppShellContext } from '@/context/app-shell-context'
import { useRegisterModal } from '@/context/modal-context'
import { useLibrary } from '@/hooks/use-library'
import { getSessionTitle } from '@/utils/session'
import type { Resource } from '../../../shared/types'

type ResourceType = Resource['type']

/** An http(s) URL as typed, or null. */
export function parseWebUrl(text: string): URL | null {
  try {
    const url = new URL(text.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** A searchable single pick over `options` (id and title). */
function Picker({ id, options, value, onChange }: { id: string; options: { id: string; title: string }[]; value: string | null; onChange: (id: string | null) => void }) {
  const { t } = useTranslation()
  const titleOf = (ref: string) => options.find((o) => o.id === ref)?.title ?? ''
  return (
    <Combobox items={options.map((o) => o.id)} value={value} onValueChange={(next) => onChange(next as string | null)} itemToStringLabel={titleOf}>
      <ComboboxInput id={id} placeholder={t('resources.search')} />
      <ComboboxContent>
        <ComboboxEmpty>{t('resources.noResults')}</ComboboxEmpty>
        <ComboboxList>
          {(ref: string) => (
            <ComboboxItem key={ref} value={ref}>
              <span className="truncate">{titleOf(ref)}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export function ResourceDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (resource: Resource) => void }) {
  const { t } = useTranslation()
  useRegisterModal(open, () => onOpenChange(false))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('resources.new')}</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open: the fields start empty each time, the library loads only then. */}
        <ResourceForm onAdd={(resource) => { onAdd(resource); onOpenChange(false) }} />
      </DialogContent>
    </Dialog>
  )
}

function ResourceForm({ onAdd }: { onAdd: (resource: Resource) => void }) {
  const { t } = useTranslation()
  const [type, setType] = React.useState<ResourceType>('url')
  const [url, setUrl] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [ref, setRef] = React.useState<string | null>(null)
  const [touched, setTouched] = React.useState(false)
  const { items } = useLibrary()
  const { activeWorkspaceId, workspaces } = useAppShellContext()
  const metas = useAtomValue(sessionMetaMapAtom)

  const libraryOptions = React.useMemo(
    () => items.filter((item) => item.type !== 'folder').map((item) => ({ id: item.id, title: item.title })),
    [items],
  )
  // The workspace's chats (a remote workspace's sessions carry the remote workspace's id), as on the Chats index.
  const remoteId = workspaces.find((w) => w.id === activeWorkspaceId)?.remoteServer?.remoteWorkspaceId
  const chatOptions = React.useMemo(
    () => Array.from(metas.values())
      .filter((s) => !s.hidden && (s.workspaceId === activeWorkspaceId || (remoteId && s.workspaceId === remoteId)))
      .map((s) => ({ id: s.id, title: getSessionTitle(s) })),
    [metas, activeWorkspaceId, remoteId],
  )
  const options = type === 'library' ? libraryOptions : chatOptions

  const webUrl = parseWebUrl(url)
  const ready = type === 'url' ? !!webUrl : !!ref

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!ready) return
    const resource: Resource = type === 'url'
      ? { type, ref: webUrl!.href, title: (title.trim() || webUrl!.host).slice(0, MAX_RESOURCE_TITLE) }
      : { type, ref: ref!, title: (options.find((o) => o.id === ref)?.title || ref!).slice(0, MAX_RESOURCE_TITLE) }
    onAdd(resource)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <FieldGroup className="gap-4">
        <Tabs size="compact" value={type} onValueChange={(next) => { setType(next as ResourceType); setRef(null); setTouched(false) }}>
          <TabsList>
            <TabsTrigger value="url">{t('resources.typeUrl')}</TabsTrigger>
            <TabsTrigger value="library">{t('resources.typeLibrary')}</TabsTrigger>
            <TabsTrigger value="chat">{t('resources.typeChat')}</TabsTrigger>
          </TabsList>
        </Tabs>
        {type === 'url' ? (
          <>
            <Field data-invalid={touched && !webUrl ? true : undefined}>
              <FieldLabel htmlFor="resource-url">{t('resources.url')}</FieldLabel>
              <Input
                id="resource-url"
                type="url"
                autoFocus
                value={url}
                placeholder="https://"
                aria-invalid={touched && !webUrl ? true : undefined}
                onChange={(e) => setUrl(e.target.value)}
              />
              {touched && !webUrl && <FieldError>{t('resources.invalidUrl')}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="resource-title">{t('resources.linkTitle')}</FieldLabel>
              <Input id="resource-title" value={title} maxLength={MAX_RESOURCE_TITLE} placeholder={webUrl?.host} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field>
            <FieldLabel htmlFor="resource-pick">{type === 'library' ? t('resources.typeLibrary') : t('resources.typeChat')}</FieldLabel>
            <Picker key={type} id="resource-pick" options={options} value={ref} onChange={setRef} />
          </Field>
        )}
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>{t('common.cancel')}</DialogClose>
        <Button type="submit" disabled={touched && !ready}>{t('resources.add')}</Button>
      </DialogFooter>
    </form>
  )
}
