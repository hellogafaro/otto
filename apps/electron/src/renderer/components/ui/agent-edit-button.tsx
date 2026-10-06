/**
 * AgentEditButton
 *
 * The Edit button of a page that changes a thing with the agent: it prefills the floating composer with a
 * sentence naming the thing ("Edit the source GitHub to ") and focuses it, cursor at the end. Enter there
 * starts the chat. There is no popover of its own (DESIGN.md, Edit with the agent). A no-op outside the shell.
 */

import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useComposer } from '@/components/composer/composer-provider'

export function AgentEditButton({ prompt }: { prompt: string }) {
  const { t } = useTranslation()
  const composer = useComposer()
  return (
    <Button variant="outline" size="compact" onClick={() => composer.prefill(`${prompt} `)}>
      {t('common.edit')}
    </Button>
  )
}
