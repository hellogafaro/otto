import * as React from 'react'
import { Archive, CircleCheck, CircleDashed, CircleDot, Cpu, Flag, MoreHorizontal, Plus, SquarePen, Tag } from 'lucide-react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { FilterBar, FilterMenu, NoResults, type FilterField, type FilterValues } from '@workspace/ui/components/filters'
import { ListGroup, ListRow } from '@workspace/ui/components/list-group'
import { PageWrap } from '@workspace/ui/components/page'
import { PageHeaderRow } from '@workspace/ui/components/page-frame'
import { cn } from '@/lib/utils'
import type { ComponentEntry } from './types'

// =============================================================================
// The grouped list (Otto v1's table: ListGroup / ListRow, 16px in the line-only PageWrap) with the
// title row's ghost Filter and New chat, the filter chips and the no-results state,
// in light and dark side by side, on realistic data: three groups, long titles,
// label and model badges, a current row, unread and read titles.
// =============================================================================

type Status = 'progress' | 'todo' | 'done'

const STATUSES: Record<Status, { label: string; icon: React.ReactNode; tint?: string }> = {
  progress: { label: 'In progress', icon: <CircleDot className="text-info" />, tint: 'var(--info)' },
  todo: { label: 'Todo', icon: <CircleDashed className="text-muted-foreground" /> },
  done: { label: 'Done', icon: <CircleCheck className="text-success" />, tint: 'var(--success)' },
}

const LABELS: Record<string, string> = { research: 'bg-violet-500', design: 'bg-pink-500', bug: 'bg-red-500', ops: 'bg-amber-500' }

interface Row {
  id: string
  title: string
  status: Status
  labels: string[]
  model?: string
  time: string
  unread?: boolean
  flagged?: boolean
}

const ROWS: Row[] = [
  { id: 'a', title: 'Draft the quarterly investor update with revenue, burn and hiring plan for the board meeting next week', status: 'progress', labels: ['research', 'ops', 'design'], model: 'Opus 4.8', time: '3m', unread: true },
  { id: 'b', title: 'Fix flaky login test on CI', status: 'progress', labels: ['bug'], model: 'GPT-6 Astra', time: '24m', flagged: true },
  { id: 'c', title: 'Summarize customer interviews from last week', status: 'todo', labels: ['research'], model: 'Opus 4.8', time: '1h', unread: true },
  { id: 'd', title: 'Plan the Lisbon offsite agenda', status: 'todo', labels: [], time: '3h' },
  { id: 'e', title: 'Review pull request for the billing migration', status: 'todo', labels: ['ops'], model: 'Sonnet 5', time: '1d' },
  { id: 'f', title: 'Research vector databases for semantic search', status: 'done', labels: ['research', 'design'], model: 'GPT-6 Astra', time: '2d' },
  { id: 'g', title: 'Write the onboarding email sequence', status: 'done', labels: [], model: 'Opus 4.8', time: '3w' },
]

function Dot({ label }: { label: string }) {
  return <span className="flex size-3.5 items-center justify-center"><span className={cn('size-2 rounded-full', LABELS[label])} /></span>
}

function Meta({ row }: { row: Row }) {
  const shown = row.labels.slice(0, 2)
  const more = row.labels.length - shown.length
  return (
    <>
      {shown.map((l) => (
        <Badge key={l} variant="outline"><Dot label={l} />{l[0].toUpperCase() + l.slice(1)}</Badge>
      ))}
      {more > 0 && <Badge variant="outline">+{more}</Badge>}
      {row.model && <Badge variant="outline"><Cpu />{row.model}</Badge>}
    </>
  )
}

const FIELDS: FilterField[] = [
  {
    key: 'status',
    label: 'Status',
    icon: <CircleDashed />,
    options: (Object.keys(STATUSES) as Status[]).map((s) => ({
      value: s, label: STATUSES[s].label, icon: STATUSES[s].icon, count: ROWS.filter((r) => r.status === s).length,
    })),
  },
  {
    key: 'label',
    label: 'Labels',
    icon: <Tag />,
    options: Object.keys(LABELS).map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1), icon: <Dot label={l} />, count: ROWS.filter((r) => r.labels.includes(l)).length })),
  },
  { key: 'flagged', label: 'Flagged', icon: <Flag />, count: ROWS.filter((r) => r.flagged).length },
  { key: 'archived', label: 'Archived', icon: <Archive />, count: 0 },
]

function ListTablePanel({ mode, initial }: { mode: 'light' | 'dark'; initial: FilterValues }) {
  const [values, setValues] = React.useState<FilterValues>(initial)
  const on = (key: string) => values[key] ?? []
  const rows = ROWS.filter((r) =>
    (!on('status').length || on('status').includes(r.status)) &&
    (!on('label').length || r.labels.some((l) => on('label').includes(l))) &&
    (!on('flagged').length || r.flagged) &&
    !on('archived').length)
  const more = (
    <Button variant="ghost" size="icon-compact" aria-label="More"><MoreHorizontal /></Button>
  )
  return (
    <div className={cn(mode === 'dark' && 'dark', 'flex min-h-[760px] min-w-0 flex-col bg-sidebar p-5 text-foreground')}>
      <PageHeaderRow
        title="Chats"
        actions={
          <>
            <FilterMenu fields={FIELDS} values={values} onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))} label="Filter chats" />
            <Button variant="ghost" size="icon-compact" aria-label="New chat"><SquarePen /></Button>
          </>
        }
      />
      <div className="flex flex-1 flex-col gap-3 pt-8">
        <FilterBar
          fields={FIELDS}
          values={values}
          onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))}
          isLabel="is"
          isAnyOfLabel="is any of"
          removeLabel={(f) => `Remove ${f}`}
        />
        {rows.length === 0 ? (
          <NoResults title="No results" description="Try changing or clearing your filters.">
            <Button variant="outline" onClick={() => setValues({})}>Clear filters</Button>
          </NoResults>
        ) : (
          <PageWrap padded>
            {(Object.keys(STATUSES) as Status[]).map((s) => {
              const items = rows.filter((r) => r.status === s)
              return (
                <ListGroup
                  key={s}
                  icon={STATUSES[s].icon}
                  label={STATUSES[s].label}
                  tint={STATUSES[s].tint}
                  count={items.length}
                  defaultOpen={s !== 'done'}
                  action={<Button variant="ghost" size="icon-xs" aria-label="New chat"><Plus /></Button>}
                >
                  {items.map((r) => (
                    <ListRow
                      key={r.id}
                      media={STATUSES[r.status].icon}
                      title={r.title}
                      muted={!r.unread}
                      active={r.id === 'c'}
                      marks={
                        <>
                          {r.unread && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                          {r.flagged && <Flag className="size-3.5 shrink-0 text-info" />}
                        </>
                      }
                      meta={<Meta row={r} />}
                      end={r.time}
                      actions={more}
                    />
                  ))}
                </ListGroup>
              )
            })}
          </PageWrap>
        )}
      </div>
    </div>
  )
}

export function ListTablePage() {
  return (
    <div className="grid min-w-[1700px] grid-cols-2">
      <ListTablePanel mode="light" initial={{ label: ['research', 'design'] }} />
      <ListTablePanel mode="dark" initial={{}} />
    </div>
  )
}

export const listTableComponents: ComponentEntry[] = [
  {
    id: 'list-table',
    name: 'List table (grouped list)',
    category: 'Shell',
    description: 'ListGroup / ListRow in the PageWrap line box, the header Filter, filter chips and no results, light and dark side by side.',
    component: ListTablePage,
    props: [],
    layout: 'top',
    previewOverflow: 'auto',
  },
]
