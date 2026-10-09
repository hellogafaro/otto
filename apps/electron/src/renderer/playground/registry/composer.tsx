import { ArrowUp, Check, Mic, Plus, Square, X } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Composer, ComposerInput, ComposerMainButton } from '@workspace/ui/components/composer'
import { AttachmentRail } from '@/components/composer/attachment-rail'
import type { ComposerFile } from '@/components/composer/use-composer-files'
import type { ComponentEntry } from './types'

const FILES: ComposerFile[] = [
  { id: 'a', name: 'Banner-mobile-2026-08-10.jpg', type: 'image/jpeg', size: 120_000, state: 'done' },
  { id: 'b', name: 'notes.md', type: 'text/markdown', size: 2_300, state: 'uploading' },
  { id: 'c', name: 'quarterly-report-final-v3.pdf', type: 'application/pdf', size: 1_480_000, state: 'error' },
  { id: 'd', name: 'pasted-text-1.txt', type: 'text/plain', size: 18_000, state: 'done' },
]

function ComposerPreview({ text, busy, files, listening }: { text: string; busy: boolean; files: boolean; listening: boolean }) {
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
    <div className="flex w-full max-w-[768px] justify-center rounded-xl bg-sidebar p-6">
      <Composer
        onSubmit={(event) => event.preventDefault()}
        attachments={files ? <AttachmentRail files={FILES} onRemove={() => {}} onRetry={() => {}} /> : null}
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
    description: 'The one full composer: responsive width, attachment rail, send, stop and dictation',
    component: ComposerPreview,
    props: [
      { name: 'text', control: { type: 'textarea' }, defaultValue: '' },
      { name: 'busy', control: { type: 'boolean' }, defaultValue: false },
      { name: 'files', control: { type: 'boolean' }, defaultValue: false },
      { name: 'listening', control: { type: 'boolean' }, defaultValue: false },
    ],
    variants: [
      { name: 'Empty', props: { text: '' } },
      { name: 'With files', props: { text: 'Summarize these', files: true } },
      { name: 'Listening', props: { listening: true } },
      { name: 'Busy', props: { text: '', busy: true } },
    ],
  },
]
