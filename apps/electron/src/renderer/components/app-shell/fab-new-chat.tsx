import { Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import { FloatingActionButton } from "@workspace/ui/components/floating-action-button"
import { useActionLabel } from "@/actions"
import { Kbd } from "@/components/ui/kbd"

/**
 * The floating "+" on Chats: starts a new chat. Bottom-right of the page card, so
 * it is placed inside the `ContentCard`; the tooltip is the label and the action's key.
 */
export function FabNewChat({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  const { hotkey } = useActionLabel("app.newChat")
  return (
    <FloatingActionButton
      // The chat's composer is as wide as the 768px column: below 930px the button would sit on it.
      className="@max-[930px]/panel:hidden"
      aria-label={t("menu.newChat")}
      tooltip={<>{t("menu.newChat")}{hotkey && <Kbd>{hotkey}</Kbd>}</>}
      onClick={onClick}
    >
      <Plus />
    </FloatingActionButton>
  )
}
