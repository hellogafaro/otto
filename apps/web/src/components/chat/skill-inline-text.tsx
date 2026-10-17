import { Predicate } from "effect";
import { Children, cloneElement, isValidElement, useMemo, type ReactNode } from "react";
import type { ServerProviderSkill } from "@otto/contracts";
import { formatProviderSkillDisplayName } from "@otto/client-runtime/providerSkills";

import { CHAT_INLINE_SKILL_CHIP_CLASS_NAME, INLINE_TAG_CLASS_NAME } from "../composer-inline-chip";
import { useRosterStore } from "../roster/roster-store";

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
      return <MarkdownInlineText text={child} skills={skills} />;
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

export function botMentionPattern(names: ReadonlyArray<string>): RegExp | null {
  const escaped = names
    .filter((name) => name.length > 0)
    .sort((left, right) => right.length - left.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  return escaped.length === 0
    ? null
    : new RegExp(`(^|[\\s(])@(${escaped.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
}

/** Otto: A bot's reply chips `@Name` for roster bots like a sent message's mentions, then skills. */
function MarkdownInlineText(props: { text: string; skills: ReadonlyArray<InlineSkill> }) {
  const bots = useRosterStore((state) => state.bots);
  const pattern = useMemo(() => botMentionPattern(bots.map((bot) => bot.name)), [bots]);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of pattern ? props.text.matchAll(pattern) : []) {
    const start = (match.index ?? 0) + (match[1] ?? "").length;
    const rawText = `@${match[2] ?? ""}`;

    if (start > cursor) {
      nodes.push(
        <SkillInlineText
          key={cursor}
          text={props.text.slice(cursor, start)}
          skills={props.skills}
        />,
      );
    }

    nodes.push(
      <span key={`@${start}`} className={INLINE_TAG_CLASS_NAME} data-markdown-copy={rawText}>
        {rawText}
      </span>,
    );
    cursor = start + rawText.length;
  }

  if (cursor === 0) return <SkillInlineText text={props.text} skills={props.skills} />;

  if (cursor < props.text.length) {
    nodes.push(
      <SkillInlineText key={cursor} text={props.text.slice(cursor)} skills={props.skills} />,
    );
  }

  return <>{nodes}</>;
}

function SkillChip(props: { skill: InlineSkill; rawText: string }) {
  return (
    <span className={CHAT_INLINE_SKILL_CHIP_CLASS_NAME} data-markdown-copy={props.rawText}>
      {formatProviderSkillDisplayName(props.skill)}
    </span>
  );
}
