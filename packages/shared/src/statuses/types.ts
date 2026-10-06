/**
 * Status Types
 *
 * Types for configurable session statuses.
 * Statuses are rows of `statuses` (./schema.ts); `StatusConfig.id` is the row's `slug`.
 *
 * Icon format: one string
 * - Emoji: "✅", "🔥" - rendered as text
 * - Image data URL: "data:image/svg+xml;base64,..." of at most 16 KB (SVGs using currentColor take the status color)
 *
 * Color format: EntityColor (system color string or custom color object)
 * - System: "accent", "foreground/50", "info/80" (uses CSS variables, auto light/dark)
 * - Custom: { light: "#EF4444", dark: "#F87171" } (explicit values)
 */

import type { EntityColor } from '../colors/types.ts'

/**
 * Status category determines filtering behavior:
 * - 'open': Appears in inbox (listInboxSessions)
 * - 'closed': Appears in completed (listCompletedSessions, with 'archived')
 * - 'archived': the one fixed `archived` status: archiving a chat moves it there (nobody creates another)
 */
export type StatusCategory = 'open' | 'closed' | 'archived';

/** The categories a person can give a status. */
export type EditableStatusCategory = 'open' | 'closed';

/**
 * Status configuration (stored in statuses/config.json)
 */
export interface StatusConfig {
  /** Unique ID (slug-style: 'todo', 'in-progress', 'my-custom-status') */
  id: string;

  /** Display name */
  label: string;

  /** Optional color. If omitted, uses design system defaults from colors module. */
  color?: EntityColor;

  /** Icon: an emoji or an image data URL (at most 16 KB); omit for the default circle. */
  icon?: string;

  /** Category (open = inbox, closed = archive) */
  category: StatusCategory;

  /** If true, cannot be deleted/renamed (todo, done, cancelled, archived): the slug is in `FIXED_STATUS_IDS` */
  isFixed: boolean;

  /** If true, the status new chats get: exactly one per workspace (todo unless another is picked); cannot be deleted */
  isDefault: boolean;

  /** Display order in UI (lower = first) */
  position: number;
}

/**
 * The shape of the old `statuses/config.json`, which the importer reads (and nothing else)
 */
export interface WorkspaceStatusConfig {
  /** Schema version for migrations (start at 1) */
  version: number;

  /** Array of status configurations (the old `order` is today's `position`) */
  statuses: Array<Omit<StatusConfig, 'position'> & { order: number }>;

  /** Default status ID for new sessions (typically 'todo') */
  defaultStatusId: string;
}

/**
 * Input for creating a new status (via CRUD operations)
 */
export interface CreateStatusInput {
  label: string;
  color?: EntityColor;
  icon?: string; // Emoji or image data URL
  category: EditableStatusCategory;
}

/**
 * Input for updating an existing status
 */
export interface UpdateStatusInput {
  label?: string;
  color?: EntityColor;
  icon?: string; // Emoji or image data URL
  category?: EditableStatusCategory;
}
