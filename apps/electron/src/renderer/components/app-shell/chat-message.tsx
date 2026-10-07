/**
 * The transcript's rows, Slack-like (DESIGN.md, Chats > One chat): a group opens with the author's 28px avatar,
 * their name (their color, "You" in the text color for the viewer) and the time; the rows after it keep the 28px gutter, where hovering shows the time.
 * Agents and people use the same row; an agent's name carries the "Agent" tag. What a row holds (a person's text,
 * an agent's turn card) is the caller's.
 *
 * `WindowedRow` keeps a long chat's DOM flat: a row far from the viewport drops its content and keeps its
 * measured height, so only the rows near the viewport are rendered.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Message, MessageAvatar, MessageContent, MessageHeader, messageAuthorColors } from '@workspace/ui/components/message'
import { cn } from '@/lib/utils'
import { isAgentActor } from '@/lib/actors'
import { useLoadedAgents } from '@/hooks/use-agents'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { AgentAvatar } from '@/components/people/agent-avatar'
import { authorNameClass } from './chat-transcript'

export interface TranscriptPerson {
  name: string
  avatar: React.ReactNode
  isAgent: boolean
}

/** Names and avatars of a chat's authors (`user:<id>` people, `agent:<id>` agents), and the viewer's actor. The viewer is "You", never their own name; their avatar keeps their initials. */
export function useTranscriptPeople(): { me: string | null; personOf: (actor: string) => TranscriptPerson } {
  const { t } = useTranslation()
  const agents = useLoadedAgents()
  const { nameOf, me } = useWorkspaceMembers()
  return React.useMemo(() => {
    const personOf = (actor: string): TranscriptPerson => {
      if (!isAgentActor(actor)) {
        const own = actor === me
        return { name: own ? t('members.you') : nameOf(actor), avatar: <ActorAvatar actor={actor} name={nameOf(actor)} size="md" />, isAgent: false }
      }
      const id = actor.slice('agent:'.length)
      // `agent:default` (older rows) is the workspace's default agent, the first
      const agent = agents.find((entry) => entry.id === id) ?? (id === 'default' ? agents[0] : undefined)
      return agent
        ? { name: agent.title, avatar: <AgentAvatar agent={agent} size="md" />, isAgent: true }
        : { name: nameOf(actor), avatar: <ActorAvatar actor={actor} size="md" />, isAgent: true }
    }
    return { me, personOf }
  }, [agents, nameOf, me, t])
}

/** The time of day ("3:42 PM"); `bare` drops the day period for the 28px gutter ("3:42"). */
export function formatMessageTime(at: number, language: string, bare = false): string {
  const parts = new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).formatToParts(at)
  return parts.filter((part) => !bare || part.type !== 'dayPeriod').map((part) => part.value).join('').trim()
}

export function MessageRow({
  actor,
  me,
  person,
  header,
  at,
  children,
}: {
  actor: string | null
  /** The viewer's actor: their name is drawn in the plain text color. */
  me: string | null
  person: TranscriptPerson | null
  /** The row opens a group: the avatar, name and time; else the gutter with the time on hover. */
  header: boolean
  at: number
  children: React.ReactNode
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? 'en'
  const opens = header && person && actor
  return (
    <Message>
      {opens ? (
        <MessageAvatar>{person.avatar}</MessageAvatar>
      ) : (
        <div className="w-7 shrink-0 select-none" data-search-exclude="true">
          <time
            dateTime={new Date(at).toISOString()}
            className="block pt-1 text-right text-[10px] leading-4 text-muted-foreground tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100 pointer-coarse:hidden"
          >
            {formatMessageTime(at, language, true)}
          </time>
        </div>
      )}
      <MessageContent className="gap-1">
        {opens && (
          <MessageHeader className="gap-2 px-0 text-sm select-none" data-search-exclude="true">
            <span className={cn('min-w-0 truncate', authorNameClass(actor, me, messageAuthorColors))}>{person.name}</span>
            {person.isAgent && (
              <span className="shrink-0 rounded-xs bg-muted px-1 text-[10px] leading-4 text-muted-foreground">{t('entities.type_agent')}</span>
            )}
            <time dateTime={new Date(at).toISOString()} className="shrink-0 text-xs font-normal tabular-nums">
              {formatMessageTime(at, language)}
            </time>
          </MessageHeader>
        )}
        {children}
      </MessageContent>
    </Message>
  )
}

export interface TranscriptWindowing {
  observe: (element: Element, onChange: (near: boolean, height: number) => void) => () => void
}

/**
 * One IntersectionObserver on the transcript's viewport, reporting whether each row is within 1500px of it.
 * Null while `enabled` is false (in-chat search walks the rendered text, so it needs every row).
 */
export function useTranscriptWindowing(viewportRef: React.RefObject<HTMLDivElement | null>, enabled: boolean, resetKey?: string): TranscriptWindowing | null {
  const [windowing, setWindowing] = React.useState<TranscriptWindowing | null>(null)
  React.useEffect(() => {
    const root = viewportRef.current
    if (!enabled || !root) {
      setWindowing(null)
      return
    }
    const listeners = new Map<Element, (near: boolean, height: number) => void>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting, entry.boundingClientRect.height)
    }, { root, rootMargin: '1500px 0px' })
    setWindowing({
      observe(element, onChange) {
        listeners.set(element, onChange)
        observer.observe(element)
        return () => {
          observer.unobserve(element)
          listeners.delete(element)
        }
      },
    })
    return () => {
      observer.disconnect()
      setWindowing(null)
    }
  }, [enabled, viewportRef, resetKey])
  // Off in the same render that turns it off: every row renders before in-chat search walks them
  return enabled ? windowing : null
}

/**
 * A transcript row that renders its content only near the viewport; away from it the row is an empty box of the
 * height it was measured at when it left, so the scroll height and position never move. A row is rendered once
 * when it mounts (to be measured). Limit: a row's height is not re-measured while away, so resizing the window
 * leaves the boxes at their old heights until each comes back (the browser's scroll anchoring absorbs it).
 */
export function WindowedRow({
  windowing,
  rowRef,
  children,
  ...props
}: React.ComponentProps<'div'> & { windowing: TranscriptWindowing | null; rowRef?: (element: HTMLDivElement | null) => void }) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [away, setAway] = React.useState<number | null>(null)
  React.useEffect(() => {
    const element = ref.current
    setAway(null)
    if (!windowing || !element) return
    return windowing.observe(element, (near, height) => setAway(near ? null : height))
  }, [windowing])
  const setRef = React.useCallback((element: HTMLDivElement | null) => {
    ref.current = element
    rowRef?.(element)
  }, [rowRef])
  const hidden = !!windowing && away !== null
  return (
    <div ref={setRef} {...props} style={hidden ? { ...props.style, height: away } : props.style}>
      {hidden ? null : children}
    </div>
  )
}
