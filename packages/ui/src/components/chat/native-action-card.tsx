import * as React from 'react'
import { ChevronDown, CircleCheck, Folder, Library } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@workspace/ui/components/collapsible'
import { Label } from '@workspace/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@workspace/ui/components/radio-group'
import { Textarea } from '@workspace/ui/components/textarea'
import { Markdown } from '../markdown/markdown'

export interface NativeActionArtifact {
  type: 'library' | 'project' | 'task'
  id: string
  title: string
}

export interface NativeActionCardData {
  id: string
  kind: 'approval' | 'question' | 'artifact'
  status: 'pending' | 'resolving' | 'approved' | 'denied' | 'canceled' | 'expired' | 'failed'
  title: string
  summary: string
  details?: string
  actorName?: string
  resolvedAt?: number
  artifact?: NativeActionArtifact
  choices?: readonly { label: string; description?: string }[]
  selectionMode?: 'single_select' | 'multi_select'
}

export interface NativeActionCardProps {
  data: NativeActionCardData
  canResolve: boolean
  onApprove?: () => Promise<void>
  onDeny?: () => Promise<void>
  onAnswer?: (answer: string | string[]) => Promise<void>
  onOpenArtifact?: (artifact: NativeActionArtifact) => void
}

export function NativeActionCard(props: NativeActionCardProps) {
  return <NativeActionCardContent key={props.data.id} {...props} />
}

function NativeActionCardContent({ data, canResolve, onApprove, onDeny, onAnswer, onOpenArtifact }: NativeActionCardProps) {
  const titleId = React.useId()
  const answerId = React.useId()
  const errorId = React.useId()
  const [answer, setAnswer] = React.useState('')
  const [selected, setSelected] = React.useState<string[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState(false)
  const submittingRef = React.useRef(false)
  const statusRef = React.useRef<HTMLParagraphElement>(null)
  const focusedRef = React.useRef(false)
  const previousStatus = React.useRef(data.status)
  const previousCanResolve = React.useRef(canResolve)
  const current = React.useRef({ status: data.status, canResolve })
  current.current = { status: data.status, canResolve }
  const pending = data.status === 'pending'
  const busy = submitting || data.status === 'resolving'
  const actionable = pending && canResolve
  const choices = data.choices ?? []
  const multiple = data.selectionMode === 'multi_select'
  const hasAnswer = choices.length && multiple ? selected.length > 0 : answer.trim().length > 0
  const terminal = !pending && data.status !== 'resolving'
  const resolvedAt = data.resolvedAt === undefined ? null : new Date(data.resolvedAt)
  const ArtifactIcon = data.artifact?.type === 'library' ? Library : data.artifact?.type === 'project' ? Folder : CircleCheck
  const statusLabel = {
    pending: data.kind === 'question' ? 'Awaiting answer' : data.kind === 'approval' ? 'Awaiting approval' : 'Not ready',
    resolving: 'Resolving',
    approved: data.kind === 'question' ? 'Answered' : data.kind === 'artifact' ? 'Created' : 'Approved',
    denied: 'Denied',
    canceled: 'Canceled',
    expired: 'Expired',
    failed: 'Failed',
  }[data.status]
  const summary = data.kind === 'question' && data.summary === 'Answer this question to continue the current run.'
    ? {
      pending: data.summary,
      resolving: data.summary,
      approved: 'Your answer was recorded.',
      denied: 'This question was declined and can no longer be answered.',
      canceled: 'This question was canceled and can no longer be answered.',
      expired: 'The run has ended. This question can no longer be answered.',
      failed: 'This question failed and can no longer be answered.',
    }[data.status]
    : data.summary

  React.useLayoutEffect(() => {
    if (focusedRef.current && ((previousStatus.current !== data.status && !pending) || (previousCanResolve.current && !canResolve))) statusRef.current?.focus()
    previousStatus.current = data.status
    previousCanResolve.current = canResolve
    if (!pending) {
      submittingRef.current = false
      setSubmitting(false)
      setError(false)
    }
  }, [data.status, pending, canResolve])

  async function submit(resolve: (() => Promise<void>) | undefined) {
    if (!resolve || submittingRef.current || current.current.status !== 'pending' || !current.current.canResolve) return
    submittingRef.current = true
    setSubmitting(true)
    setError(false)
    try {
      await resolve()
    } catch {
      if (current.current.status === 'pending') {
        submittingRef.current = false
        setSubmitting(false)
        setError(true)
      }
    }
  }

  return (
    <Card
      size="sm"
      role="group"
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onFocusCapture={() => { focusedRef.current = true }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) focusedRef.current = false
      }}
    >
      <CardHeader>
        <CardTitle id={titleId} role="heading" aria-level={3} className="break-words">{data.title}</CardTitle>
        <p ref={statusRef} role="status" aria-live="polite" tabIndex={-1} className="text-muted-foreground">
          {statusLabel}
          {terminal && data.actorName && <> · {data.actorName}</>}
          {terminal && resolvedAt && Number.isFinite(resolvedAt.getTime()) && (
            <> · <time dateTime={resolvedAt.toISOString()}>{resolvedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></>
          )}
        </p>
      </CardHeader>
      <CardContent>
        <Markdown mode="minimal">{summary}</Markdown>
        {data.details && (
          <Collapsible>
            <CollapsibleTrigger render={<Button variant="ghost" />} className="group/details">
              Details <ChevronDown aria-hidden className="group-aria-expanded/details:rotate-180" data-icon="inline-end" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="max-h-64 overflow-auto break-words py-3">
                <Markdown mode="minimal">{data.details}</Markdown>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        {data.artifact && data.status === 'approved' && (
          <div>
            <Button variant="outline" className="max-w-full" disabled={!onOpenArtifact} onClick={() => onOpenArtifact?.(data.artifact!)}>
              <ArtifactIcon aria-hidden />
              <span className="min-w-0 truncate">{data.artifact.title}</span>
            </Button>
          </div>
        )}
        {actionable && data.kind === 'approval' && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !onApprove} onClick={() => void submit(onApprove)}>Approve</Button>
            <Button variant="outline" disabled={busy || !onDeny} onClick={() => void submit(onDeny)}>Deny</Button>
          </div>
        )}
        {actionable && data.kind === 'question' && (
          <form className="flex flex-col gap-3" onSubmit={(event) => {
            event.preventDefault()
            if (hasAnswer) void submit(onAnswer ? () => onAnswer(choices.length && multiple ? selected : answer.trim()) : undefined)
          }}>
            {choices.length > 0 ? (
              multiple ? (
                <fieldset disabled={busy} className="flex flex-col gap-3">
                  <legend className="sr-only">Choose answers</legend>
                  {choices.map((choice, index) => (
                    <Label key={choice.label} htmlFor={`${answerId}-${index}`}>
                      <Checkbox id={`${answerId}-${index}`} disabled={busy} checked={selected.includes(choice.label)} onCheckedChange={(checked) => {
                        setSelected((values) => checked ? [...values, choice.label] : values.filter((value) => value !== choice.label))
                      }} />
                      <span><span>{choice.label}</span>{choice.description && <span className="block text-muted-foreground">{choice.description}</span>}</span>
                    </Label>
                  ))}
                </fieldset>
              ) : (
                <RadioGroup aria-label="Choose an answer" value={answer} disabled={busy} onValueChange={(value) => setAnswer(String(value))}>
                  {choices.map((choice, index) => (
                    <Label key={choice.label} htmlFor={`${answerId}-${index}`}>
                      <RadioGroupItem id={`${answerId}-${index}`} value={choice.label} />
                      <span><span>{choice.label}</span>{choice.description && <span className="block text-muted-foreground">{choice.description}</span>}</span>
                    </Label>
                  ))}
                </RadioGroup>
              )
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor={answerId}>Your answer</Label>
                <Textarea id={answerId} value={answer} disabled={busy} aria-describedby={error ? errorId : undefined} onChange={(event) => setAnswer(event.target.value)} />
              </div>
            )}
            <div><Button type="submit" disabled={busy || !hasAnswer || !onAnswer}>Send answer</Button></div>
          </form>
        )}
        {pending && !canResolve && data.kind !== 'artifact' && <p className="text-muted-foreground">You can view this request, but cannot resolve it.</p>}
        {pending && error && <p id={errorId} role="alert">Could not submit your response. Refresh the conversation and try again.</p>}
      </CardContent>
    </Card>
  )
}
