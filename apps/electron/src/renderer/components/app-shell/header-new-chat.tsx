import { useTranslation } from "react-i18next"
import { useActionLabel } from "@/actions"
import { CreateButton } from "@/components/ui/create-button"

/** The page header's New chat on Chats: the create "+" with the action's key in its tooltip. */
export function HeaderNewChat({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  const { hotkey } = useActionLabel("app.newChat")
  return <CreateButton label={t("menu.newChat")} hotkey={hotkey || undefined} onClick={onClick} />
}
