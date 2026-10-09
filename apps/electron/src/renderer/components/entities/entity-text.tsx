/**
 * EntityText - markdown content (a comment) through the app's renderer, with every `<type>:<id>` token outside
 * code drawn as an `EntityChip`. The token is what is stored; the chip looks its title up when drawn.
 */

import * as React from 'react'
import type { Components } from 'react-markdown'
import { Markdown } from '@/components/markdown'
import { EntityChip } from './entity-chip'
import { toEntityMarkdown } from './entity-tokens'

const COMPONENTS: Partial<Components> = {
  span: ({ node: _node, ...props }) => {
    const entity = (props as Record<string, unknown>)['data-entity']
    return typeof entity === 'string'
      ? <span className="not-typeset font-sans text-sm" data-not-typeset><EntityChip entity={entity} /></span>
      : <span {...props} />
  },
}

const openUrl = (url: string) => void window.electronAPI.openUrl(url)

export function EntityText({ content, className }: { content: string; className?: string }) {
  const markdown = React.useMemo(() => toEntityMarkdown(content), [content])
  return (
    <Markdown mode="minimal" className={className} components={COMPONENTS} onUrlClick={openUrl}>
      {markdown}
    </Markdown>
  )
}
