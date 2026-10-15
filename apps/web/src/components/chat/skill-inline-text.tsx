import { Predicate } from "effect";
import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import type { ServerProviderSkill } from "@otto/contracts";
import { formatProviderSkillDisplayName } from "@otto/client-runtime/providerSkills";

import { CHAT_INLINE_SKILL_CHIP_CLASS_NAME } from "../composer-inline-chip";

const SKILL_TOKEN_REGEX = /(^|\s)\$([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/g;

type InlineSkill = Pick<ServerProviderSkill, "name" | "displayName" | "icon">;

export function SkillInlineText(props: { text: string; skills: ReadonlyArray<InlineSkill> }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of props.text.matchAll(SKILL_TOKEN_REGEX)) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    const rawText = `$${name}`;
    const skill = props.skills.find((candidate) => candidate.name === name);

    if (!skill) {
      continue;
    }

    if (start > cursor) {
      nodes.push(props.text.slice(cursor, start));
    }

    nodes.push(<SkillChip key={`${start}:${name}`} skill={skill} rawText={rawText} />);
    cursor = start + rawText.length;
  }

  if (cursor === 0) {
    return <>{props.text}</>;
  }

  if (cursor < props.text.length) {
    nodes.push(props.text.slice(cursor));
  }

  return <>{nodes}</>;
}

export function renderSkillInlineMarkdownChildren(
  children: ReactNode,
  skills: ReadonlyArray<InlineSkill>,
): ReactNode {
  return Children.map(children, (child) => {
    if (Predicate.isString(child)) {
      return <SkillInlineText text={child} skills={skills} />;
    }

    if (!isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(child)) {
      return child;
    }

    // Custom react-markdown components replace the intrinsic type, so also
    // check the hast node they carry.
    const markdownTagName = Predicate.isString(child.type) ? child.type : child.props.node?.tagName;

    if (markdownTagName === "code" || markdownTagName === "a") {
      return child;
    }

    if (!("children" in child.props)) {
      return child;
    }

    return cloneElement(
      child,
      undefined,
      renderSkillInlineMarkdownChildren(child.props.children, skills),
    );
  });
}

function SkillChip(props: { skill: InlineSkill; rawText: string }) {
  return (
    <span className={CHAT_INLINE_SKILL_CHIP_CLASS_NAME} data-markdown-copy={props.rawText}>
      {formatProviderSkillDisplayName(props.skill)}
    </span>
  );
}
