import { ArrowUp, Check, Inbox, MessageSquare, Mic, Plus, Square, X } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Composer, ComposerInput, ComposerMainButton, type ComposerVariant } from '@workspace/ui/components/composer'
import { Kbd } from '@workspace/ui/components/kbd'
import { ListRow } from '@workspace/ui/components/list-group'
import { AttachmentRail } from '@/components/composer/attachment-rail'
import type { ComposerFile } from '@/components/composer/use-composer-files'
import type { ComponentEntry } from './types'

const FILES: ComposerFile[] = [
  { id: 'a', name: 'Banner-mobile-2026-08-10.jpg', type: 'image/jpeg', size: 120_000, state: 'done' },
  { id: 'b', name: 'notes.md', type: 'text/markdown', size: 2_300, state: 'uploading' },
  { id: 'c', name: 'quarterly-report-final-v3.pdf', type: 'application/pdf', size: 1_480_000, state: 'error' },
  { id: 'd', name: 'pasted-text-1.txt', type: 'text/plain', size: 18_000, state: 'done' },
]

// The shell composer's looks (DESIGN.md, Composer): the compact bar, expanded and full on one surface, with the
// rail, the Inbox button and its list, the held-modifier key and dictation. Static: the state machine, the send path, files and
// dictation live in `components/composer/shell-composer.tsx`.
function ComposerPreview({ variant, text, busy, files, held, listening, inbox }: { variant: ComposerVariant; text: string; busy: boolean; files: boolean; held: boolean; listening: boolean; inbox: boolean }) {
  const main = listening ? (
    <ComposerMainButton label="Done" shortcut="↵"><Check /></ComposerMainButton>
  ) : busy ? (
    <ComposerMainButton label="Stop" shortcut="Esc"><Square className="fill-current" /></ComposerMainButton>
  ) : text || files ? (
    <ComposerMainButton type="submit" label="Send" shortcut="↵"><ArrowUp /></ComposerMainButton>
  ) : (
    <ComposerMainButton label="Dictate"><Mic /></ComposerMainButton>
  )
  return (
    <div className="flex w-[768px] justify-center rounded-xl bg-sidebar p-6">
      <Composer
        variant={variant}
        onSubmit={(event) => event.preventDefault()}
        attachments={files ? <AttachmentRail files={FILES} full={variant === 'full'} onRemove={() => {}} onRetry={() => {}} /> : null}
        leading={listening
          ? <Button type="button" variant="ghost" size="icon" aria-label="Cancel dictation"><X /></Button>
          : <Button type="button" variant="ghost" size="icon" aria-label="Add files"><Plus /></Button>}
        tools={listening ? (
          <>
            <span data-slot="dictation" className="flex h-5 min-w-0 flex-1 items-center gap-0.5 overflow-hidden px-2">
              {Array.from({ length: 40 }, (_, i) => <span key={i} className="h-full w-1 shrink-0 rounded-full bg-muted-foreground" style={{ transform: `scaleY(${0.2 + Math.abs(Math.sin(i / 3)) * 0.8})` }} />)}
            </span>
            <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">0:07</span>
          </>
        ) : null}
        attention={listening ? null : held ? (
          <span className="flex h-8 min-w-8 items-center justify-center"><Kbd>⌘J</Kbd></span>
        ) : !text && !files ? (
          <Button type="button" variant="ghost" size="icon" aria-label="Inbox, 2 need you" aria-expanded={inbox} className="relative">
            <Inbox />
            <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive" />
          </Button>
        ) : null}
        panel={inbox ? (
          <ul aria-label="Inbox">
            <ListRow size="sm" media={<MessageSquare className="text-muted-foreground" />} title="Draft the launch email" marks={<span className="size-2 shrink-0 rounded-full bg-info" />} end="2m" />
            <ListRow size="sm" media={<MessageSquare className="text-muted-foreground" />} title="Summarize the Q3 report" marks={<span className="size-1.5 shrink-0 rounded-full bg-primary" />} end="1h" />
          </ul>
        ) : null}
        main={main}
      >
        <ComposerInput>
          <div role="textbox" aria-label="Ask your agents about this task" className="whitespace-pre-wrap">
            {text || <span data-slot="composer-placeholder">Ask your agents about this task</span>}
          </div>
        </ComposerInput>
      </Composer>
    </div>
  )
}

export const composerComponents: ComponentEntry[] = [
  {
    id: 'shell-composer',
    name: 'Composer',
    category: 'Chat Inputs',
    description: 'The one composer: compact bar, expanded and full looks, the attachment rail, keys while a modifier is held, dictation',
    component: ComposerPreview,
    props: [
      { name: 'variant', control: { type: 'select', options: [{ label: 'Compact', value: 'compact' }, { label: 'Expanded', value: 'expanded' }, { label: 'Full', value: 'full' }] }, defaultValue: 'compact' },
      { name: 'text', control: { type: 'textarea' }, defaultValue: '' },
      { name: 'busy', control: { type: 'boolean' }, defaultValue: false },
      { name: 'files', control: { type: 'boolean' }, defaultValue: false },
      { name: 'held', control: { type: 'boolean' }, defaultValue: false },
      { name: 'listening', control: { type: 'boolean' }, defaultValue: false },
      { name: 'inbox', control: { type: 'boolean' }, defaultValue: false },
    ],
    variants: [
      { name: 'Compact, idle', props: { variant: 'compact', text: '' } },
      { name: 'Compact, ⌘ held', props: { variant: 'compact', text: '', held: true } },
      { name: 'Compact, Inbox open', props: { variant: 'compact', text: '', inbox: true } },
      { name: 'Expanded with files', props: { variant: 'expanded', text: 'What is left before we can close this task?', files: true } },
      { name: 'Full', props: { variant: 'full', text: '' } },
      { name: 'Full with files', props: { variant: 'full', text: 'Summarize these', files: true } },
      { name: 'Compact, listening', props: { variant: 'compact', listening: true } },
      { name: 'Full, listening', props: { variant: 'full', listening: true } },
      { name: 'Busy', props: { variant: 'full', text: '', busy: true } },
    ],
  },
]
