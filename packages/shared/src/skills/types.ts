/**
 * Skills Types
 *
 * Type definitions for workspace skills.
 * Skills are specialized instructions that extend Claude's capabilities.
 */

/**
 * Skill metadata from SKILL.md YAML frontmatter
 */
export interface SkillMetadata {
  /** Display name for the skill */
  name: string;
  /** Brief description shown in skill list */
  description: string;
  /** Optional file patterns that trigger this skill */
  globs?: string[];
  /** Optional tools to always allow when skill is active */
  alwaysAllow?: string[];
  /**
   * Optional icon - emoji or URL only.
   * - Emoji: rendered directly in UI (e.g., "🔧")
   * - URL: auto-downloaded to icon.{ext} file
   * Note: Relative paths and inline SVG are NOT supported.
   */
  icon?: string;
  /** Optional source slugs to auto-enable when this skill is invoked */
  requiredSources?: string[];
}

/**
 * Plugin name the SDK gives the global and project skill folders (`~/.agents`, `{project}/.agents`).
 * Those scopes no longer exist; the name stays only until the agent code that still resolves it (pre-tool-use,
 * the renderer's mention qualification) is rewritten with the harness work.
 */
export const AGENTS_PLUGIN_NAME = '.agents';

/** A workspace skill's row (the table's index of its bundle); see ./store.ts. */
export interface Skill {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** The actor that made it: 'user:<id>' or 'agent:<id>'. */
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A skill with parsed content, read from its folder in the workspace (the local copy of the bundle).
 * The list a client sees (`getLoadedSkills`) is made of the rows, each read from its folder when the folder is there.
 */
export interface LoadedSkill {
  /** Directory name (slug) */
  slug: string;
  /** Parsed metadata from YAML frontmatter */
  metadata: SkillMetadata;
  /** Full SKILL.md content (without frontmatter) */
  content: string;
  /** Absolute path to icon file if exists */
  iconPath?: string;
  /** Absolute path to skill directory */
  path: string;
}
