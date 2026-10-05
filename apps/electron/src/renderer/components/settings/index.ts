/**
 * Settings Components
 *
 * Reusable UI components for building settings pages.
 * Provides consistent styling and behavior across the app.
 *
 * @example
 * import {
 *   SettingsSection,
 *   SettingsCard,
 *   SettingsToggle,
 *   SettingsRadioGroup,
 *   SettingsRadioCard,
 * } from '@/components/settings'
 */

// Structure
export {
  SettingsSection,
  type SettingsSectionProps,
} from './settings-section'

export {
  SettingsCard,
  SettingsCardContent,
  SettingsCardFooter,
  type SettingsCardProps,
} from './settings-card'

// Rows
export {
  SettingsRow,
  SettingsRowLabel,
  type SettingsRowProps,
} from './settings-row'

export {
  SettingsToggle,
  type SettingsToggleProps,
} from './settings-toggle'

// Selection
export {
  SettingsRadioGroup,
  SettingsRadioCard,
  SettingsRadioOption,
  type SettingsRadioGroupProps,
  type SettingsRadioCardProps,
  type SettingsRadioOptionProps,
} from './settings-radio-group'

export {
  SettingsSegmentedControl,
  SettingsSegmentedControlCard,
  type SettingsSegmentedControlProps,
  type SettingsSegmentedOption,
  type SettingsSegmentedControlCardProps,
  type SettingsSegmentedCardOption,
} from './settings-segmented-control'

export {
  SettingsSelect,
  SettingsSelectRow,
  type SettingsSelectProps,
  type SettingsSelectOption,
  type SettingsSelectRowProps,
} from './settings-select'

export {
  SettingsMenuSelect,
  SettingsMenuSelectRow,
  type SettingsMenuSelectProps,
  type SettingsMenuSelectOption,
  type SettingsMenuSelectRowProps,
} from './settings-menu-select'

// Inputs
export {
  SettingsInput,
  SettingsInputRow,
  SettingsSecretInput,
  type SettingsInputProps,
  type SettingsInputRowProps,
  type SettingsSecretInputProps,
} from './settings-input'

export {
  SettingsTextarea,
  type SettingsTextareaProps,
} from './settings-textarea'
