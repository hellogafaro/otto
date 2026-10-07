/**
 * `AgentAvatar`: an agent's picture. `avatar` empty is the generated one, a shape on a tint, both picked from the
 * agent's id (a stable hash, so it is the same everywhere and on every device; no mascots); `library:<id>` is an image
 * uploaded to the library, shown over the generated one while it loads or when it cannot be read.
 */

import * as React from 'react'
import { Circle, Diamond, Hexagon, Square, Star, Triangle } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@workspace/ui/components/avatar'
import { cn } from '@/lib/utils'
import { actorColorIndex } from '@/lib/actors'
import { libraryImageUrl } from '@/lib/library-image'
import { TINTS } from './actor-avatar'
import type { Agent } from '../../../shared/types'

const SHAPES = [Circle, Square, Triangle, Diamond, Hexagon, Star]

/** The generated avatar of an agent id: which shape and which tint. */
export function generatedAvatar(id: string): { shape: number; tint: number } {
  return { shape: actorColorIndex(`shape:${id}`, SHAPES.length), tint: actorColorIndex(`agent:${id}`, TINTS.length) }
}

/** The library item of an uploaded avatar, else null. */
export const avatarLibraryId = (avatar: string): string | null => (avatar.startsWith('library:') ? avatar.slice('library:'.length) : null)

export function AgentAvatar({
  agent,
  size = 'default',
  className,
}: {
  agent: Pick<Agent, 'id' | 'avatar'>
  size?: 'default' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const libraryId = avatarLibraryId(agent.avatar)
  const [src, setSrc] = React.useState<string | undefined>()
  React.useEffect(() => {
    setSrc(undefined)
    if (!libraryId) return
    let live = true
    libraryImageUrl(libraryId).then((url) => live && setSrc(url), () => undefined)
    return () => {
      live = false
    }
  }, [libraryId])
  const { shape, tint } = generatedAvatar(agent.id)
  const Shape = SHAPES[shape]
  return (
    <Avatar size={size} className={className}>
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback className={cn('text-foreground/70', TINTS[tint])}>
        <Shape className="fill-current" aria-hidden />
      </AvatarFallback>
    </Avatar>
  )
}
