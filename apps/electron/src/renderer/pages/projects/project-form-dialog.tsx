/**
 * ProjectFormDialog - New project: Title and Description, then `createProject`.
 *
 * Used by the Projects index ("+" and its empty state), and open to the Tasks page and the
 * sidebar. After creating it opens the new project, unless the caller takes over with
 * `onCreated` (a picker that wants to stay where it is). A failure is a toast and the dialog
 * stays open with what was typed.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Textarea } from '@workspace/ui/components/textarea'
import { Spinner } from '@workspace/ui/components/spinner'
import { toast } from '@workspace/ui/components/sonner'
import { MAX_DESCRIPTION, MAX_TITLE } from '@otto/shared/projects/limits'
import { routes } from '@/lib/navigate'
import { useNavigation } from '@/contexts/navigation-context'
import { useRegisterModal } from '@/context/modal-context'
import { useProjects } from '@/hooks/use-projects'
import type { Project } from '../../../shared/types'

interface ProjectFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new project instead of opening it. */
  onCreated?: (project: Project) => void
}

export function ProjectFormDialog({ open, onOpenChange, onCreated }: ProjectFormDialogProps) {
  const { t } = useTranslation()
  useRegisterModal(open, () => onOpenChange(false))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('projects.newProject')}</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open: the fields start empty each time. */}
        <ProjectForm onDone={() => onOpenChange(false)} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  )
}

function ProjectForm({ onDone, onCreated }: { onDone: () => void; onCreated?: (project: Project) => void }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { createProject } = useProjects()
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [pending, setPending] = React.useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pending || !title.trim()) return
    setPending(true)
    const result = await createProject({ title: title.trim(), description: description.trim() })
    setPending(false)
    if (!result.ok) {
      toast.error(t('projects.createFailed'))
      return
    }
    onDone()
    if (onCreated) onCreated(result.value)
    else navigate(routes.view.projects({ projectId: result.value.id }))
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="project-title">{t('projects.fieldTitle')}</FieldLabel>
          <Input
            id="project-title"
            value={title}
            maxLength={MAX_TITLE}
            onChange={(event) => setTitle(event.target.value)}
            disabled={pending}
            autoComplete="off"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="project-description">{t('common.description')}</FieldLabel>
          <Textarea
            id="project-description"
            value={description}
            maxLength={MAX_DESCRIPTION}
            onChange={(event) => setDescription(event.target.value)}
            disabled={pending}
          />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>{t('common.cancel')}</DialogClose>
        <Button type="submit" disabled={pending || !title.trim()}>
          {pending && <Spinner data-icon="inline-start" />}
          {t('common.create')}
        </Button>
      </DialogFooter>
    </form>
  )
}
