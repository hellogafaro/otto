import { Match } from "effect";
import { isGroupPersonMember, type ServerProviderSkill } from "@otto/contracts";
import {
  collectComposerInlineTokens,
  collectComposerResourceMentions,
  type ComposerResourceMention,
} from "@otto/shared/composerInlineTokens";

import { type ReactNode, useMemo } from "react";

import { useI18n } from "../../i18n";
import { useThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useCachedTasks } from "../../state/tasks";
import { INLINE_TAG_CLASS_NAME } from "../composer-inline-chip";
import { useBotPromptResourceLabel } from "../roster/bot-prompt-mentions";
import { findNameMentions } from "../roster/bot-prompt-mentions.logic";
import { useRosterStore } from "../roster/roster-store";
import { parseReplyPrompt } from "./message-controls";
import { ReplyReference } from "./reply-reference";
import { SkillInlineText } from "./skill-inline-text";

/**
 * Renders the text of a sent message. A reply serialized by `buildReplyPrompt` keeps a
 * durable backlink to what it answered: one compact quoted line above the body, instead
 * of the raw `>` markdown the provider receives. `$name` tokens that match `skills` render
 * as skill chips, like the classic chat.
 */
export function SentMessageText({
  text,
  skills = NO_SKILLS,
  replySourceMessageId = null,
}: {
  readonly text: string;
  readonly skills?: ReadonlyArray<ServerProviderSkill> | undefined;
  /** The answered message, when it is on screen, so the backlink can jump to it. */
  readonly replySourceMessageId?: string | null;
}) {
  const reply = parseReplyPrompt(text);

  if (!reply) {
    return (
      <p className="whitespace-pre-wrap">
        <MentionText text={text} skills={skills} />
      </p>
    );
  }

  return (
    <>
      <div className="mb-1.5" data-testid="sent-reply-backlink">
        <ReplyReference
          label={reply.label}
          text={reply.quotedText}
          sourceMessageId={replySourceMessageId}
        />
      </div>
      {reply.body ? (
        <p className="whitespace-pre-wrap">
          <MentionText text={reply.body} skills={skills} />
        </p>
      ) : null}
    </>
  );
}

const NO_SKILLS: ReadonlyArray<ServerProviderSkill> = [];

/**
 * Shows `@browser`, `@chat:<id>`, `@bot:<id>`, skill, app, and MCP server mentions, and known
 * `$skill` tokens as chips; copying still yields the raw token.
 */
function MentionText({
  text,
  skills,
}: {
  readonly text: string;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}) {
  const { t } = useI18n();
  const bots = useRosterStore((state) => state.bots);
  const groups = useRosterStore((state) => state.groups);

  const names = useMemo<ReadonlyArray<{ readonly name: string }>>(
    () => [
      { name: "everyone" },
      ...bots.map((bot) => ({ name: bot.name })),
      ...groups.flatMap((group) =>
        group.members.filter(isGroupPersonMember).map((member) => ({ name: member.displayName })),
      ),
    ],
    [bots, groups],
  );

  const plain = (segment: string, key: number) =>
    skills.length === 0 ? segment : <SkillInlineText key={key} text={segment} skills={skills} />;

  const tokens = [
    ...collectComposerInlineTokens(`${text}\n`).filter(
      (token) =>
        token.type === "browser-mention" ||
        token.type === "thread-mention" ||
        token.type === "bot-mention",
    ),
    ...collectComposerResourceMentions(`${text}\n`).map((mention) => ({
      ...mention,
      type: "resource-mention" as const,
    })),
    ...findNameMentions(text, names).map((mention) => ({
      ...mention,
      type: "name-mention" as const,
      source: text.slice(mention.start, mention.end),
    })),
  ].toSorted((left, right) => left.start - right.start);

  if (tokens.length === 0) return plain(text, 0);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const token of tokens) {
    if (token.start < cursor) continue;

    if (token.start > cursor) nodes.push(plain(text.slice(cursor, token.start), -token.start - 1));
    nodes.push(
      Match.value(token).pipe(
        Match.when({ type: "browser-mention" }, (token) => (
          <MentionChip key={token.start} source={token.source} label={t("Browser")} />
        )),
        Match.when({ type: "bot-mention" }, (token) => (
          <BotMentionChip key={token.start} source={token.source} botId={token.value} />
        )),
        Match.when({ type: "resource-mention" }, (token) => (
          <ResourceMentionChip key={token.start} mention={token} />
        )),
        Match.when({ type: "name-mention" }, (token) => (
          <MentionChip key={token.start} source={token.source} label={token.name} />
        )),
        Match.orElse((token) => (
          <ThreadMentionChip key={token.start} source={token.source} threadId={token.value} />
        )),
      ),
    );
    cursor = token.end;
  }

  if (cursor < text.length) nodes.push(plain(text.slice(cursor), -text.length - 2));

  return nodes;
}

function ThreadMentionChip({ source, threadId }: { source: string; threadId: string }) {
  const { t } = useI18n();
  const shells = useThreadShells();

  const title = useMemo(
    () => shells.find((shell) => shell.id === threadId)?.title ?? null,
    [shells, threadId],
  );

  return <MentionChip source={source} label={title ?? t("Unknown chat")} />;
}

function BotMentionChip({ source, botId }: { source: string; botId: string }) {
  const { t } = useI18n();
  const name = useRosterStore((state) => state.bots.find((bot) => bot.id === botId)?.name ?? null);

  return <MentionChip source={source} label={name ?? t("Unknown bot")} />;
}

function ResourceMentionChip({ mention }: { mention: ComposerResourceMention }) {
  const environmentId = usePrimaryEnvironmentId();
  useCachedTasks(environmentId, mention.kind === "task" ? [mention.id] : undefined);
  const label = useBotPromptResourceLabel(environmentId)(mention.kind, mention.id);

  return <MentionChip source={mention.source} label={label} />;
}

function MentionChip(props: { source: string; label: string }) {
  return (
    <span className={INLINE_TAG_CLASS_NAME} data-markdown-copy={props.source}>
      @{props.label}
    </span>
  );
}
