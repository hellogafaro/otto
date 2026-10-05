import { Plus, SquarePen } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@workspace/ui/components/button"
import { FloatingActionButton } from "@workspace/ui/components/floating-action-button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { useActionLabel } from "@/actions"
import { Kbd } from "@/components/ui/kbd"

/** The label and the action's key: both buttons' tooltip. */
function useNewChatTooltip() {
  const { t } = useTranslation()
  const { hotkey } = useActionLabel("app.newChat")
  return { label: t("menu.newChat"), tooltip: <>{t("menu.newChat")}{hotkey && <Kbd>{hotkey}</Kbd>}</> }
}

/**
 * The floating "+" on Chats: starts a new chat. Bottom-right of the page card, so
 * it is placed inside the `ContentCard`; the tooltip is the label and the action's key.
 * Hidden while the card is narrower than 930px (`HeaderNewChat` replaces it).
 */
export function FabNewChat({ onClick }: { onClick: () => void }) {
  const { label, tooltip } = useNewChatTooltip()
  return (
    <FloatingActionButton
      // The chat's composer is as wide as the 768px column: below 930px the button would sit on it.
      className="@max-[930px]/panel:hidden"
      aria-label={label}
      tooltip={tooltip}
      onClick={onClick}
    >
      <Plus />
    </FloatingActionButton>
  )
}

/**
 * The page header's New chat: a 28px ghost button, shown only while the card is
 * narrower than 930px (and so on a phone), where the floating "+" is hidden.
 */
export function HeaderNewChat({ onClick }: { onClick: () => void }) {
  const { label, tooltip } = useNewChatTooltip()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-compact"
            className="@min-[930px]/panel:hidden"
            aria-label={label}
            onClick={onClick}
          >
            <SquarePen />
          </Button>
        }
      />
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  )
}
