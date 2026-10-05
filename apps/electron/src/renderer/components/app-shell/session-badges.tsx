import { useMemo } from "react"
import { parseLabelEntry, formatDisplayValue } from "@otto/shared/labels"
import { resolveEntityColor } from "@otto/shared/colors"
import { useTheme } from "@/context/theme-context"
import { useSessionListContext } from "@/context/session-list-context"
import type { SessionMeta } from "@/atoms/sessions"
import type { LabelConfig } from "@otto/shared/labels"

interface SessionBadgesProps {
  item: SessionMeta
}

/** A session's labels as the row's second line: a colored dot and the name, then the value if it has one. */
export function SessionBadges({ item }: SessionBadgesProps) {
  const ctx = useSessionListContext()
  const { isDark } = useTheme()

  const resolvedLabels = useMemo(() => {
    if (!item.labels || item.labels.length === 0 || ctx.flatLabels.length === 0) return []
    return item.labels
      .map(entry => {
        const parsed = parseLabelEntry(entry)
        const config = ctx.flatLabels.find(l => l.id === parsed.id)
        if (!config) return null
        return { config, rawValue: parsed.rawValue }
      })
      .filter((l): l is { config: LabelConfig; rawValue: string | undefined } => l != null)
  }, [item.labels, ctx.flatLabels])

  if (resolvedLabels.length === 0) return null

  return (
    <>
      {resolvedLabels.map(({ config, rawValue }, idx) => {
        const color = config.color ? resolveEntityColor(config.color, isDark) : null
        const value = rawValue ? formatDisplayValue(rawValue, config.valueType) : undefined
        return (
          <span
            key={`${config.id}-${idx}`}
            title={value ? `${config.name} · ${value}` : config.name}
            className="flex max-w-28 shrink-0 items-center gap-1"
          >
            <span
              className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
              style={color ? { backgroundColor: color } : undefined}
            />
            <span className="truncate">{config.name}</span>
            {value && <span className="truncate opacity-60">· {value}</span>}
          </span>
        )
      })}
    </>
  )
}
