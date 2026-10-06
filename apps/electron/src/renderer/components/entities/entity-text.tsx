/**
 * EntityText - markdown content (a comment) through the app's renderer, with every `<type>:<id>` token outside
 * code drawn as an `EntityChip`. The token is what is stored; the chip looks its title up when drawn.
 */

import * as React from 'react'
import type { Components } from 'react-markdown'
import { Markdown } from '@/components/markdown'
import { cn } from '@/lib/utils'
import { EntityChip } from './entity-chip'
import { toEntityMarkdown } from './entity-tokens'

const COMPONENTS: Partial<Components> = {
  span: ({ node: _node, ...props }) => {
    const entity = (props as Record<string, unknown>)['data-entity']
    return typeof entity === 'string' ? <EntityChip entity={entity} /> : <span {...props} />
  },
}

const openUrl = (url: string) => void window.electronAPI.openUrl(url)

export function EntityText({ content, className }: { content: string; className?: string }) {
  const markdown = React.useMemo(() => toEntityMarkdown(content), [content])
  return (
    // The first and last blocks drop their outer margin, so the text starts on its container's line.
    <Markdown mode="minimal" className={cn('[&>:first-child]:mt-0 [&>:last-child]:mb-0', className)} components={COMPONENTS} onUrlClick={openUrl}>
      {markdown}
    </Markdown>
  )
}
