import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { settingsUI } from "@/components/settings/settings-ui-constants"

interface AddWorkspace_RadioOptionProps {
  name: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
  title: string
  subtitle: string | ReactNode
  action?: ReactNode
}

/**
 * AddWorkspace_RadioOption - A radio row for a SettingsCard in the workspace creation flows
 *
 * Used in:
 * - AddWorkspaceStep_CreateNew: Location selection
 */
export function AddWorkspace_RadioOption({
  name,
  checked,
  onChange,
  disabled = false,
  title,
  subtitle,
  action
}: AddWorkspace_RadioOptionProps) {
  return (
    <label className={cn(
      "flex w-full cursor-pointer items-center gap-3 px-4 py-3 transition-colors",
      "hover:bg-muted/70 has-[:focus-visible]:bg-muted/70",
      disabled && "cursor-not-allowed opacity-50"
    )}>
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="sr-only"
      />
      <span className={cn(
        "relative flex size-4 shrink-0 items-center justify-center rounded-full",
        checked ? "bg-primary" : "bg-input/90"
      )}>
        {checked && <span className="size-2 rounded-full bg-primary-foreground" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className={settingsUI.label}>{title}</div>
        <div className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>
          {typeof subtitle === 'string' ? (
            <div className="truncate">{subtitle}</div>
          ) : (
            subtitle
          )}
        </div>
      </div>
      {action}
    </label>
  )
}
