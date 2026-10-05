import type { ComponentEntry } from './types'
import { Logo } from '@workspace/ui/components/logo'
import { SquarePenRounded } from '@/components/icons/square-pen-rounded'

export const iconComponents: ComponentEntry[] = [
  {
    id: 'otto-logo',
    name: 'Logo',
    category: 'Icons',
    description: 'Otto mark (design/ui Logo). Drawn with currentColor: text-foreground, never the primary color',
    component: Logo,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes for size and color',
        control: { type: 'string' },
        defaultValue: 'size-6 text-foreground',
      },
    ],
    variants: [
      { name: 'size-4', props: { className: 'size-4 text-foreground' } },
      { name: 'size-5', props: { className: 'size-5 text-foreground' } },
      { name: 'size-6', props: { className: 'size-6 text-foreground' } },
      { name: 'size-8', props: { className: 'size-8 text-foreground' } },
      { name: 'size-10', props: { className: 'size-10 text-foreground' } },
    ],
  },
  {
    id: 'square-pen-rounded',
    name: 'SquarePenRounded',
    category: 'Icons',
    description: 'New chat/compose icon with rounded corners',
    component: SquarePenRounded,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes',
        control: { type: 'string' },
        defaultValue: 'h-5 w-5',
      },
    ],
    variants: [
      { name: 'Default', props: { className: 'h-5 w-5' } },
      { name: 'Large', props: { className: 'h-8 w-8' } },
      { name: 'Primary', props: { className: 'h-5 w-5 text-foreground' } },
    ],
  },
]
