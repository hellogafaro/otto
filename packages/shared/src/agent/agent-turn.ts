/**
 * What a chat's agent gives each Pi turn (docs/final-plan.md 2.6, M1): its instructions as XML groups, the sources
 * and skills it may use, and the computer its built-in tools run on. Read fresh each turn, so an agent edited
 * mid-chat applies at the next message.
 */

import { PRODUCT_NAME } from '../branding.ts';
import { assembleInstructions, getAgentRunConfig, type AgentRunConfig, type InstructionSource, type RunMode } from '../agents/index.ts';
import { createComputer, type Computer } from '../computer/index.ts';
import { getSkills } from '../skills/index.ts';
import { getSources, isSourceUsable, loadAllSources } from '../sources/index.ts';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import type { PiTurnSkill } from './backend/pi/protocol.ts';

export interface AgentTurn {
  /** Appended after the base system prompt: workspace and agent instructions, tools, connected sources, run mode. */
  instructions: string;
  /** Slugs of the sources the agent may use; null = every usable source. */
  sourceSlugs: readonly string[] | null;
  /** The agent's skills as Pi lists them (`<available_skills>`), SKILL.md where this turn's tools read it. */
  skills: PiTurnSkill[];
  /** Where this turn's tools find the skill folders: `/skills` in a box, else the workspace's folder. */
  skillsDir: string;
  /** Where the built-in tools run; null = on the host (`OTTO_COMPUTER` unset or `local`). */
  computer: Computer | null;
}

/** Where the workspace's skills folder is mounted read-only in an agent's box (DockerComputer). */
export const SKILLS_MOUNT = '/skills';

export const COMPUTER_TOOL_GUIDANCE =
  `Your built-in tools (read, write, edit, bash, ls) run on your own Linux computer, not on the server. grep and find are not available there: use bash (rg, find). The workspace's skills are in ${SKILLS_MOUNT} (read-only).`;

const computers = new Map<string, Computer>();

/**
 * The agent's computer: one box per agent with `OTTO_COMPUTER=docker` (started at its first tool call), none with
 * `local` or unset (the tools run on the host, as before). Limit: one box per agent id for the life of the process.
 */
export function getAgentComputer(agentId: string, skillsDir: string, kind = process.env.OTTO_COMPUTER): Computer | null {
  if (kind !== 'docker') return null;
  let computer = computers.get(agentId);
  if (!computer) computers.set(agentId, (computer = createComputer('docker', { agentId, skillsDir })));
  return computer;
}

/** `[]` = every item; otherwise the items named by id or slug. */
function pick<T extends { id: string; slug: string }>(items: readonly T[], named: readonly string[]): T[] {
  return named.length ? items.filter((item) => named.includes(item.id) || named.includes(item.slug)) : [...items];
}

/** The turn from data already read (pure; `getAgentTurn` reads it). */
export function buildAgentTurn(input: {
  run: Pick<AgentRunConfig, 'agent' | 'workspaceInstructions' | 'agentInstructions' | 'skills' | 'sources'>;
  /** The workspace's skill rows. */
  skills: readonly { id: string; slug: string; title: string; description: string }[];
  /** The workspace's source rows. */
  sources: readonly { id: string; slug: string }[];
  /** The sources switched on in this chat and usable (signed in). */
  connected: readonly InstructionSource[];
  workspaceRootPath: string;
  runMode: RunMode;
  computer: Computer | null;
}): AgentTurn {
  const { run, computer } = input;
  const skillsDir = computer ? SKILLS_MOUNT : getWorkspaceSkillsPath(input.workspaceRootPath);
  const sourceSlugs = run.sources.length ? pick(input.sources, run.sources).map((source) => source.slug) : null;
  return {
    instructions: assembleInstructions({
      product: PRODUCT_NAME,
      workspaceInstructions: run.workspaceInstructions,
      agent: { title: run.agent.title, instructions: run.agentInstructions },
      toolGuidance: computer ? [COMPUTER_TOOL_GUIDANCE] : [],
      sources: input.connected.filter((source) => !sourceSlugs || sourceSlugs.includes(source.slug)),
      runMode: input.runMode,
    }),
    sourceSlugs,
    skills: pick(input.skills, run.skills).map((skill) => ({
      name: skill.slug,
      description: skill.description || skill.title,
      filePath: `${skillsDir}/${skill.slug}/SKILL.md`,
    })),
    skillsDir,
    computer,
  };
}

/**
 * The turn of a chat: its agent (`agentId`; absent or deleted = the workspace's default agent), read with the
 * workspace's skills and sources. Null when the workspace has no agent yet.
 */
export function getAgentTurn(input: {
  agentId?: string | null;
  workspaceId: string;
  workspaceRootPath: string;
  /** The chat's switched-on sources (`enabledSourceSlugs`). */
  enabledSourceSlugs?: readonly string[];
  runMode: RunMode;
}): AgentTurn | null {
  const run = getAgentRunConfig(input.agentId, input.workspaceId);
  if (!run) return null;
  const enabled = new Set(input.enabledSourceSlugs ?? []);
  const connected = enabled.size
    ? loadAllSources(input.workspaceRootPath)
        .filter((source) => enabled.has(source.config.slug) && isSourceUsable(source))
        .map((source) => ({ slug: source.config.slug, title: source.config.name, description: source.config.tagline }))
    : [];
  return buildAgentTurn({
    run,
    skills: getSkills(input.workspaceId),
    sources: getSources(input.workspaceId),
    connected,
    workspaceRootPath: input.workspaceRootPath,
    runMode: input.runMode,
    computer: getAgentComputer(run.agent.id, getWorkspaceSkillsPath(input.workspaceRootPath)),
  });
}
