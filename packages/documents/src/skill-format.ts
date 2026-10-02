import { DomainError } from "@otto/shared";

import { z } from "zod";

const metadata = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\p{Ll}\p{N}]+(?:-[\p{Ll}\p{N}]+)*$/u),
    description: z.string().trim().min(1).max(1024),
    license: z.string().max(1000).optional(),
    compatibility: z.string().min(1).max(500).optional(),
    metadata: z.record(z.string().max(100), z.string().max(1000)).optional(),
    "allowed-tools": z.string().max(2000).optional(),
  })
  .strict();
/** Agent Skills frontmatter is data only; allowed-tools never grants Otto capabilities. */
export function parseSkillFile(source: string) {
  if (new TextEncoder().encode(source).length > 100000)
    throw new DomainError("invalid");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  if (!match?.[1] || match[2] === undefined)
    throw new DomainError("invalid", "SKILL.md frontmatter required");
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(match[1]);
  } catch {
    throw new DomainError("invalid", "Invalid skill frontmatter");
  }
  const parsed = metadata.safeParse(raw);
  if (!parsed.success)
    throw new DomainError("invalid", "Invalid skill metadata");
  return {
    title: parsed.data.name,
    whenToUse: parsed.data.description,
    body: match[2],
    metadata: parsed.data,
  };
}
export function formatSkillFile(input: {
  title: string;
  whenToUse: string | null;
  body: string;
  skillMetadata: Record<string, unknown>;
}) {
  const parsed = metadata.safeParse({
    ...input.skillMetadata,
    name: input.title,
    description: input.whenToUse,
  });
  if (!parsed.success)
    throw new DomainError(
      "invalid",
      "Skill requires a valid name and description before export",
    );
  // JSON string values are valid YAML scalars, preserving multiline and quoted descriptions.
  const frontmatter = Object.entries(parsed.data)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return `---\n${frontmatter}\n---\n${input.body}`;
}
