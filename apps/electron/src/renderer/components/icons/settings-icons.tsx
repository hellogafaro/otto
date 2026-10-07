/**
 * Settings Icons
 *
 * Shared Lucide icon mapping for settings pages: the settings sidebar's rows and the
 * command palette's Settings items.
 */

import {
  Building2,
  CircleDot,
  Keyboard,
  MessagesSquare,
  Palette,
  ShieldCheck,
  Asterisk,
  Tag,
  ToggleRight,
  UserCircle,
  Users,
} from 'lucide-react'
import type { SettingsSubpage } from '../../../shared/types'

type IconProps = { className?: string }

export const AppSettingsIcon = ({ className }: IconProps) => <ToggleRight className={className} />
export const AiSettingsIcon = ({ className }: IconProps) => <Asterisk className={className} />
export const AppearanceIcon = ({ className }: IconProps) => <Palette className={className} />
export const InputIcon = ({ className }: IconProps) => <Keyboard className={className} />
export const WorkspaceIcon = ({ className }: IconProps) => <Building2 className={className} />
export const MembersIcon = ({ className }: IconProps) => <Users className={className} />
export const PermissionsIcon = ({ className }: IconProps) => <ShieldCheck className={className} />
export const LabelsIcon = ({ className }: IconProps) => <Tag className={className} />
export const StatusesIcon = ({ className }: IconProps) => <CircleDot className={className} />
export const MessagingSettingsIcon = ({ className }: IconProps) => <MessagesSquare className={className} />
export const ShortcutsIcon = ({ className }: IconProps) => <Keyboard className={className} />
export const PreferencesIcon = ({ className }: IconProps) => <UserCircle className={className} />

/**
 * Map of settings subpage IDs to their icon components.
 */
export const SETTINGS_ICONS: Record<SettingsSubpage, React.ComponentType<IconProps>> = {
  app: AppSettingsIcon,
  ai: AiSettingsIcon,
  appearance: AppearanceIcon,
  input: InputIcon,
  workspace: WorkspaceIcon,
  members: MembersIcon,
  permissions: PermissionsIcon,
  labels: LabelsIcon,
  statuses: StatusesIcon,
  messaging: MessagingSettingsIcon,
  shortcuts: ShortcutsIcon,
  preferences: PreferencesIcon,
}
