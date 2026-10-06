/**
 * Skill Validate Handler
 *
 * Validates a skill's SKILL.md file for correct format and required fields.
 * Skills belong to the workspace: `{workspace}/skills/{slug}/SKILL.md`.
 */

import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import {
  validateSlug,
  validateSkillContent,
  formatValidationResult,
} from '../validation.ts';

export interface SkillValidateArgs {
  skillSlug: string;
}

/**
 * Handle the skill_validate tool call.
 *
 * 1. Validate slug format
 * 2. Read the workspace's SKILL.md for the slug
 * 3. Validate its content (frontmatter + body) and return the result
 */
export async function handleSkillValidate(
  ctx: SessionToolContext,
  args: SkillValidateArgs
): Promise<ToolResult> {
  const { skillSlug } = args;

  // Validate slug format first
  const slugResult = validateSlug(skillSlug);
  if (!slugResult.valid) {
    return {
      content: [{ type: 'text', text: formatValidationResult(slugResult) }],
      isError: true,
    };
  }

  const skillPath = join(ctx.workspacePath, 'skills', skillSlug, 'SKILL.md');
  if (!ctx.fs.exists(skillPath)) {
    return errorResponse(
      `SKILL.md not found for skill "${skillSlug}". Expected ${skillPath}\n\nCreate it with YAML frontmatter.`
    );
  }

  // Read and validate content
  let content: string;
  try {
    content = ctx.fs.readFile(skillPath);
  } catch (e) {
    return errorResponse(
      `Cannot read file: ${e instanceof Error ? e.message : 'Unknown error'}`
    );
  }

  const result = validateSkillContent(content, skillSlug);
  return {
    content: [{ type: 'text', text: `Validated: ${skillPath}\n\n${formatValidationResult(result)}` }],
    isError: !result.valid, // warnings don't make it an error
  };
}
