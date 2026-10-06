/**
 * Skills Storage
 *
 * Reads a skill from its folder, `{workspace}/skills/{slug}/`: the local copy of the skill's bundle that agents read
 * by path. The truth is the `skills` table and the bundle in S3 (./store.ts); the folder is filled from them (and,
 * when an agent edits it, pushed back by the config watcher).
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import matter from 'gray-matter';
import type { LoadedSkill, SkillMetadata } from './types.ts';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import {
  validateIconValue,
  findIconFile,
  downloadIcon,
  needsIconDownload,
} from '../utils/icon.ts';

// The global (`~/.agents/skills`) and project (`<repo>/.agents/skills`) scopes are gone: only workspace skills exist.
// These two stay until agent/core/pre-tool-use.ts, which still resolves a skill's plugin name against them, is rewritten.
/** @deprecated No scope reads this folder any more. */
export const GLOBAL_AGENT_SKILLS_DIR = join(homedir(), '.agents', 'skills');

/** @deprecated No scope reads this folder any more. */
export const PROJECT_AGENT_SKILLS_DIR = '.agents/skills';

/**
 * Normalize requiredSources frontmatter to a clean string array.
 * Accepts a single string or array of strings, trims whitespace, and deduplicates.
 */
function normalizeRequiredSources(value: unknown): string[] | undefined {
  const asArray = typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value
      : undefined;

  if (!asArray) return undefined;

  const normalized = Array.from(new Set(
    asArray
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean)
  ));

  return normalized.length > 0 ? normalized : undefined;
}

// ============================================================
// Parsing
// ============================================================

/**
 * Parse SKILL.md content and extract frontmatter + body: the one place a skill's frontmatter is read (the rows' title
 * and description, the loaded skill and the guard on a bundle write all come from here). Null when `name` or
 * `description` is missing or the frontmatter is not valid YAML.
 */
export function parseSkillFile(content: string): { metadata: SkillMetadata; body: string } | null {
  try {
    const parsed = matter(content);

    // Validate required fields
    if (!parsed.data.name || !parsed.data.description) {
      return null;
    }

    // Validate and extract optional icon field
    // Only accepts emoji or URL - rejects inline SVG and relative paths
    const icon = validateIconValue(parsed.data.icon, 'Skills');

    return {
      metadata: {
        name: parsed.data.name as string,
        description: parsed.data.description as string,
        globs: parsed.data.globs as string[] | undefined,
        alwaysAllow: parsed.data.alwaysAllow as string[] | undefined,
        icon,
        requiredSources: normalizeRequiredSources(parsed.data.requiredSources),
      },
      body: parsed.content,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single skill from its folder
 * @param skillsDir - Absolute path to the workspace's skills directory
 * @param slug - Skill directory name
 */
function loadSkillFromDir(skillsDir: string, slug: string): LoadedSkill | null {
  const skillDir = join(skillsDir, slug);
  const skillFile = join(skillDir, 'SKILL.md');

  // Check directory exists
  if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) {
    return null;
  }

  // Check SKILL.md exists
  if (!existsSync(skillFile)) {
    return null;
  }

  // Read and parse SKILL.md
  let content: string;
  try {
    content = readFileSync(skillFile, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseSkillFile(content);
  if (!parsed) {
    return null;
  }

  return {
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    iconPath: findIconFile(skillDir),
    path: skillDir,
  };
}

/**
 * Load a single skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function loadSkill(workspaceRoot: string, slug: string): LoadedSkill | null {
  return loadSkillFromDir(getWorkspaceSkillsPath(workspaceRoot), slug);
}

/**
 * Load all skills of a workspace from their folders.
 * @param workspaceRoot - Absolute path to workspace root
 * @param _projectRoot - Ignored: there are no project skills. Left for base-agent.ts, which still passes it.
 */
export function loadAllSkills(workspaceRoot: string, _projectRoot?: string): LoadedSkill[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  if (!existsSync(skillsDir)) return [];
  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .flatMap((entry) => loadSkillFromDir(skillsDir, entry.name) ?? []);
  } catch {
    return [];
  }
}

// ============================================================
// Icon Download (uses shared utilities)
// ============================================================

/**
 * Download an icon from a URL and save it to the skill directory.
 * Returns the path to the downloaded icon, or null on failure.
 */
export async function downloadSkillIcon(
  skillDir: string,
  iconUrl: string
): Promise<string | null> {
  return downloadIcon(skillDir, iconUrl, 'Skills');
}

/**
 * Check if a skill needs its icon downloaded.
 * Returns true if metadata has a URL icon and no local icon file exists.
 */
export function skillNeedsIconDownload(skill: LoadedSkill): boolean {
  return needsIconDownload(skill.metadata.icon, skill.iconPath);
}

// Re-export icon utilities for convenience
export { isIconUrl } from '../utils/icon.ts';
