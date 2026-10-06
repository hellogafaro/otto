import {
  DefaultResourceLoader,
  createSyntheticSourceInfo,
  type ExtensionAPI,
  type InlineExtension,
  type SettingsManager,
  type Skill,
} from '@earendil-works/pi-coding-agent';
import type { PiTurnSkill } from '../../shared/src/agent/backend/pi/protocol.ts';

/**
 * Otto's prompt for each turn, given to Pi as Pi's own prompt options (docs/final-plan.md 2.6, M1).
 *
 * A hidden `before_agent_start` extension sets, on every `session.prompt()`, Pi's `customPrompt` to the prompt
 * Otto built for the turn and Pi's `skills` to the chat agent's skills. Pi then renders its structured prompt
 * itself: Otto's prompt, Pi's native skill list (`<available_skills>`: name, description, SKILL.md location, read
 * on demand) and the working directory. Nothing is forced over Pi's prompt, so the skill list is never lost.
 * The values are per turn (an agent edited mid-chat applies at its next message); the resource loader is read by
 * Pi only when the session is built, so it carries no turn data.
 */
export interface TurnPrompt {
  /** Inline extension to register via `createOttoResourceLoader`. */
  readonly extension: InlineExtension;
  /** The prompt and skills of the next and every later run. */
  set(turn: { systemPrompt: string; skills?: PiTurnSkill[] }): void;
}

export const OTTO_TURN_PROMPT_EXTENSION_NAME = 'otto-turn-prompt';

/** A skill as Pi lists it; Otto's name is the slug the `[skill:slug]` mention uses. */
export function toPiSkill(skill: PiTurnSkill): Skill {
  const baseDir = skill.filePath.replace(/\/SKILL\.md$/, '');
  return {
    name: skill.name,
    description: skill.description,
    filePath: skill.filePath,
    baseDir,
    sourceInfo: createSyntheticSourceInfo(skill.filePath, { source: 'otto', baseDir }),
    disableModelInvocation: false,
  };
}

export function createTurnPrompt(): TurnPrompt {
  let current: { systemPrompt: string; skills: Skill[] } | undefined;
  const factory = (pi: ExtensionAPI): void => {
    pi.on('before_agent_start', (event) => {
      if (!current) return;
      const options = event.systemPromptOptions;
      options.customPrompt = current.systemPrompt;
      options.appendSystemPrompt = '';
      options.contextFiles = [];
      options.skills = current.skills;
    });
  };
  return {
    extension: { name: OTTO_TURN_PROMPT_EXTENSION_NAME, factory, hidden: true },
    set(turn): void {
      current = { systemPrompt: turn.systemPrompt, skills: (turn.skills ?? []).map(toPiSkill) };
    },
  };
}

/**
 * The resource loader `createAgentSession` would build on its own (same cwd, agentDir and settings), with nothing
 * read from the server's disk: no context files (Otto's instructions come from the database, D8), no skills (each
 * turn names the agent's, above), no SYSTEM.md / APPEND_SYSTEM.md. `systemPrompt` is a fixed prompt (ephemeral
 * queries); `turnPrompt` the per-turn one (chats).
 */
export async function createOttoResourceLoader(options: {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
  systemPrompt?: string;
  turnPrompt?: TurnPrompt;
}): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: options.settingsManager,
    extensionFactories: options.turnPrompt ? [options.turnPrompt.extension] : [],
    noSkills: true,
    systemPromptOverride: () => options.systemPrompt,
    appendSystemPrompt: [],
    agentsFilesOverride: () => ({ agentsFiles: [] }),
  });
  await loader.reload();
  return loader;
}
