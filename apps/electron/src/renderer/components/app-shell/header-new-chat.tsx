import { SquarePen } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { useActionLabel } from "@/actions"
import { Kbd } from "@/components/ui/kbd"

/** The page header's New chat on Chats: a 28px ghost icon button; the tooltip is the label and the action's key. */
export function HeaderNewChat({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  const { hotkey } = useActionLabel("app.newChat")
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-compact" aria-label={t("menu.newChat")} onClick={onClick}>
            <SquarePen />
          </Button>
        }
      />
      <TooltipContent side="bottom">
        {t("menu.newChat")}
        {hotkey && <Kbd>{hotkey}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}
