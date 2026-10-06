import { ArrowUp, Plus, Square } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Composer, ComposerInput, ComposerMainButton, type ComposerVariant } from '@workspace/ui/components/composer'
import { Kbd } from '@workspace/ui/components/kbd'
import type { ComponentEntry } from './types'

// The shell composer's looks (DESIGN.md, Composer): the compact glass bar, the expanded glass and the full card.
// Static: the state machine and the send path live in `components/composer/shell-composer.tsx`.
function ComposerPreview({ variant, text, busy, sending }: { variant: ComposerVariant; text: string; busy: boolean; sending: boolean }) {
  return (
    <div className="flex w-[720px] justify-center rounded-xl bg-sidebar p-6">
      <Composer
        variant={variant}
        onSubmit={(event) => event.preventDefault()}
        leading={<Button type="button" variant="ghost" size="icon" aria-label="Add files" disabled><Plus /></Button>}
        hint={text ? null : <Kbd className="mr-1">⌘J</Kbd>}
        main={busy ? (
          <ComposerMainButton label="Stop" shortcut="Esc"><Square className="fill-current" /></ComposerMainButton>
        ) : (
          <ComposerMainButton type="submit" label="Send" shortcut="↵" loading={sending} disabled={!text}><ArrowUp /></ComposerMainButton>
        )}
      >
        <ComposerInput defaultValue={text} placeholder="Ask your agents about this task" aria-label="Ask your agents about this task" />
      </Composer>
    </div>
  )
}

export const composerComponents: ComponentEntry[] = [
  {
    id: 'shell-composer',
    name: 'Composer',
    category: 'Chat Inputs',
    description: 'The one composer: compact bar, expanded and full looks, with the single main button',
    component: ComposerPreview,
    props: [
      { name: 'variant', control: { type: 'select', options: [{ label: 'Compact', value: 'compact' }, { label: 'Expanded', value: 'expanded' }, { label: 'Full', value: 'full' }] }, defaultValue: 'compact' },
      { name: 'text', control: { type: 'textarea' }, defaultValue: '' },
      { name: 'busy', control: { type: 'boolean' }, defaultValue: false },
      { name: 'sending', control: { type: 'boolean' }, defaultValue: false },
    ],
    variants: [
      { name: 'Compact, idle', props: { variant: 'compact', text: '' } },
      { name: 'Expanded', props: { variant: 'expanded', text: 'What is left before we can close this task?\nList the open questions.' } },
      { name: 'Full (W2)', props: { variant: 'full', text: '' } },
      { name: 'Busy', props: { variant: 'compact', text: '', busy: true } },
    ],
  },
]
