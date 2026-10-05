import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useActionLabel } from '@/actions'
import { Kbd } from '@/components/ui/kbd'
import { useCommandPalette } from './command-palette-provider'
import type { PaletteCategory } from './palette-model'

/** A page header's Search: a 28px ghost icon button that opens the palette on the page's category. */
export function CommandPaletteButton({ category }: { category: PaletteCategory }) {
  const { t } = useTranslation()
  const { open } = useCommandPalette()
  const { hotkey } = useActionLabel('app.commandPalette')
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-compact" aria-label={t('sidebar.search')} onClick={() => open(category)}>
            <Search />
          </Button>
        }
      />
      <TooltipContent side="bottom">
        {t('sidebar.search')}
        {hotkey && <Kbd>{hotkey}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}
