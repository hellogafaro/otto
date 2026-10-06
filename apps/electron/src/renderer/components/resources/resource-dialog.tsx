/**
 * New link: a dialog that makes one `Resource` (a web link, a library item or a chat) and hands it to `onAdd`.
 * The kind is a compact `Tabs`; a web link takes a URL and an optional title (the host when left empty), a
 * library item or a chat is picked from a searchable `Combobox` and keeps its title. The caller saves it.
 */

import * as React from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
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
import { submitForm } from '@/lib/form'
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
function Picker({ id, options, value, invalid, onBlur, onChange }: { id: string; options: { id: string; title: string }[]; value: string | null; invalid: boolean; onBlur: () => void; onChange: (id: string | null) => void }) {
  const { t } = useTranslation()
  const titleOf = (ref: string) => options.find((o) => o.id === ref)?.title ?? ''
  return (
    <Combobox items={options.map((o) => o.id)} value={value} onValueChange={(next) => onChange(next as string | null)} itemToStringLabel={titleOf}>
      <ComboboxInput id={id} placeholder={t('resources.search')} aria-invalid={invalid} onBlur={onBlur} />
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

  // Only the active kind's fields count: a web link needs an address (and a short title), a library item or a chat a pick.
  const schema = z.object({
    type: z.enum(['url', 'library', 'chat']),
    url: z.string(),
    title: z.string(),
    ref: z.string().nullable(),
  }).superRefine((value, ctx) => {
    if (value.type === 'url' && !parseWebUrl(value.url)) ctx.addIssue({ code: 'custom', path: ['url'], message: t('resources.invalidUrl') })
    if (value.type === 'url' && value.title.trim().length > MAX_RESOURCE_TITLE) ctx.addIssue({ code: 'custom', path: ['title'], message: t('common.tooLong', { max: MAX_RESOURCE_TITLE }) })
    if (value.type !== 'url' && !value.ref) ctx.addIssue({ code: 'custom', path: ['ref'], message: t('common.required') })
  })
  const form = useForm({
    defaultValues: { type: 'url' as ResourceType, url: '', title: '', ref: null as string | null },
    validators: { onBlur: schema, onSubmit: schema },
    onSubmit: ({ value }) => {
      const webUrl = parseWebUrl(value.url)
      const options = value.type === 'library' ? libraryOptions : chatOptions
      onAdd(value.type === 'url'
        ? { type: 'url', ref: webUrl!.href, title: (value.title.trim() || webUrl!.host).slice(0, MAX_RESOURCE_TITLE) }
        : { type: value.type, ref: value.ref!, title: (options.find((o) => o.id === value.ref)?.title || value.ref!).slice(0, MAX_RESOURCE_TITLE) })
    },
  })
  const type = useStore(form.store, (state) => state.values.type)
  const url = useStore(form.store, (state) => state.values.url)
  const options = type === 'library' ? libraryOptions : chatOptions

  return (
    <form noValidate onSubmit={(event) => submitForm(event, form)} className="flex flex-col gap-6">
      <FieldGroup className="gap-4">
        <Tabs size="compact" value={type} onValueChange={(next) => { form.setFieldValue('type', next as ResourceType); form.resetField('ref') }}>
          <TabsList>
            <TabsTrigger value="url">{t('resources.typeUrl')}</TabsTrigger>
            <TabsTrigger value="library">{t('resources.typeLibrary')}</TabsTrigger>
            <TabsTrigger value="chat">{t('resources.typeChat')}</TabsTrigger>
          </TabsList>
        </Tabs>
        {type === 'url' ? (
          <>
            <form.Field name="url">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t('resources.url')}</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="url"
                      autoFocus
                      value={field.state.value}
                      placeholder="https://"
                      aria-invalid={isInvalid}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="title">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t('resources.linkTitle')}</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      placeholder={parseWebUrl(url)?.host}
                      aria-invalid={isInvalid}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
          </>
        ) : (
          <form.Field name="ref">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>{type === 'library' ? t('resources.typeLibrary') : t('resources.typeChat')}</FieldLabel>
                  <Picker
                    key={type}
                    id={field.name}
                    options={options}
                    value={field.state.value}
                    invalid={isInvalid}
                    onBlur={field.handleBlur}
                    onChange={field.handleChange}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
        )}
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>{t('common.cancel')}</DialogClose>
        <Button type="submit">{t('resources.add')}</Button>
      </DialogFooter>
    </form>
  )
}
