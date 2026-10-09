/**
 * The attachment rail (v1's, docs/composer.md R10): one row of file chips above the text, scrolling sideways with
 * the edge fade (`AttachmentGroup`: the end fades while more chips wait, the start once scrolled). 28px chips
 * with the kind and size. A chip being read spins and shimmers; one that failed is red, with Retry.
 */

import { useTranslation } from 'react-i18next'
import { File, FileText, Image as ImageIcon, X } from 'lucide-react'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@workspace/ui/components/attachment'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import type { ComposerFile } from './use-composer-files'

/** "PNG", "MD", "PDF": the extension, else the MIME subtype. */
export function fileKind(name: string, type: string): string {
  const extension = name.includes('.') ? name.split('.').pop() : ''
  return (extension || type.split('/')[1] || 'file').toUpperCase()
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function Media({ file }: { file: ComposerFile }) {
  const image = file.type.startsWith('image/')
  const Icon = image ? ImageIcon : file.type.startsWith('text/') ? FileText : File
  return (
    <AttachmentMedia variant={image && file.url ? 'image' : 'icon'}>
      {file.state === 'uploading' ? <Spinner /> : image && file.url ? <img src={file.url} alt="" /> : <Icon />}
    </AttachmentMedia>
  )
}

export function AttachmentRail({
  files,
  onRemove,
  onRetry,
}: {
  files: ComposerFile[]
  onRemove?: (id: string) => void
  onRetry: (id: string) => void
}) {
  const { t } = useTranslation()
  if (files.length === 0) return null
  return (
    // 4px in, like the buttons below, so the chips' 8px corners nest in the composer's 12px.
    <AttachmentGroup className="w-full pt-0">
      {files.map((file) => {
        const remove = onRemove ? (
          <AttachmentAction aria-label={t('composer.removeFile', { name: file.name })} onClick={() => onRemove(file.id)}>
            <X />
          </AttachmentAction>
        ) : null
        return (
          <div key={file.id} className="flex flex-col gap-1">
            <Attachment size="sm" state={file.state} title={file.name}>
              <Media file={file} />
              <AttachmentContent>
                <AttachmentTitle>{file.name}</AttachmentTitle>
                <AttachmentDescription>
                  {file.state === 'uploading'
                    ? t('composer.adding')
                    : file.state === 'error'
                      ? t('composer.error.read')
                      : `${fileKind(file.name, file.type)} · ${fileSize(file.size)}`}
                </AttachmentDescription>
              </AttachmentContent>
              {remove && <AttachmentActions>{remove}</AttachmentActions>}
            </Attachment>
            {file.state === 'error' && (
              <Button type="button" variant="ghost" size="xs" className="self-start" onClick={() => onRetry(file.id)}>
                {t('composer.retryUpload')}
              </Button>
            )}
          </div>
        )
      })}
    </AttachmentGroup>
  )
}
