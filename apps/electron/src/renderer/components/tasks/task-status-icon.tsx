/** A task's status as its 14px icon in the status color (DESIGN Colors: todo grey, doing purple, done green; archived muted). */

import { Archive, Circle, CircleCheck, CircleDot } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TaskStatus } from '../../../shared/types'

const ICONS = {
  todo: { Icon: Circle, color: 'text-status-todo' },
  doing: { Icon: CircleDot, color: 'text-status-doing' },
  done: { Icon: CircleCheck, color: 'text-status-done' },
  archived: { Icon: Archive, color: 'text-muted-foreground' },
} as const

export function TaskStatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const { Icon, color } = ICONS[status === 'deleted' ? 'archived' : status]
  return <Icon aria-hidden className={cn('size-3.5 shrink-0', color, className)} />
}
