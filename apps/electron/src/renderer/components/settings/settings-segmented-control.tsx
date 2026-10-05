/**
 * SettingsSegmentedControl
 *
 * Horizontal group of 28px ghost buttons; the selected one is `aria-checked`
 * (the button's selected fill). Nested in a settings row.
 * Ideal for theme selection, font selection, etc.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export interface SettingsSegmentedOption<T extends string = string> {
  /** Value for this option */
  value: T
  /** Display label */
  label: string
  /** Optional icon */
  icon?: React.ReactNode
}

export interface SettingsSegmentedControlProps<T extends string = string> {
  /** Currently selected value */
  value: T
  /** Change handler */
  onValueChange: (value: T) => void
  /** Available options */
  options: SettingsSegmentedOption<T>[]
  /** Additional className */
  className?: string
}

/**
 * SettingsSegmentedControl - Horizontal button group
 *
 * @example
 * <SettingsSegmentedControl
 *   value={theme}
 *   onValueChange={setTheme}
 *   options={[
 *     { value: 'system', label: 'System', icon: <Monitor /> },
 *     { value: 'light', label: 'Light', icon: <Sun /> },
 *     { value: 'dark', label: 'Dark', icon: <Moon /> },
 *   ]}
 * />
 */
export function SettingsSegmentedControl<T extends string = string>({
  value,
  onValueChange,
  options,
  className,
}: SettingsSegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      className={cn('inline-flex gap-1', className)}
    >
      {options.map((option) => {
        const isSelected = option.value === value

        return (
          <Button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            variant="ghost"
            size="compact"
            onClick={() => onValueChange(option.value)}
          >
            {option.icon}
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}
