import { useAtomValue } from "@effect/atom-react";
import {
  RiAtLine,
  RiTeamLine,
  RiUserLine,
  RiFileLine,
  RiGlobalLine,
  RiChat3Line,
  RiCloseLine,
  RiPuzzleLine,
  RiSparkling2Line,
} from "@remixicon/react";
import { Match } from "effect";
import { type EnvironmentId, LIBRARY_SKILLS_FOLDER_ID } from "@otto/contracts";
import type { ComposerResourceMentionKind } from "@otto/shared/composerInlineTokens";
import { rankComposerThreadMentions } from "@otto/shared/composerThreadMentions";

import {
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { useComposerPathSearch, useThreadSearch } from "../../state/queries";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { environmentSnapshotAtom } from "../../state/shell";
import { AppLogo } from "../customize/CustomizeIntegrations";
import {
  CHAT_INLINE_CHIP_LABEL_CLASS_NAME,
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
} from "../composerInlineChip";
import {
  type BotPromptMentionBot,
  type BotPromptMentionChip,
  type BotPromptMentionItem,
  type BotPromptMentionResource,
  type BotPromptMentionTrigger,
  botPromptMentionChips,
  botPromptThreadQuery,
  buildBotPromptMentionItems,
  isBotPromptThreadQuery,
} from "./botPromptMentions.logic";

/**
 * Where `@browser`, `@chat:`, and file mentions resolve: the chat's environment,
 * its project, and the project folder searched for files.
 */
export interface BotPromptMentionScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: string | null;
  readonly projectId: string | null;
  readonly cwd: string | null;
}

export interface BotPromptMentionMenuHandle {
  /** Handles picker keys. Returns true when the key was consumed. */
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

/**
 * Mentions resolve in the chat's own environment. Before a chat has its first turn
 * there is no thread yet, so every visible chat in the primary environment is offered.
 */
export function useBotPromptMentionScope(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadRef:
    | { readonly environmentId: EnvironmentId; readonly threadId: string }
    | null
    | undefined;
  readonly projectId: string | null | undefined;
  readonly cwd: string | null | undefined;
}): BotPromptMentionScope | null {
  const environmentId = input.threadRef?.environmentId ?? input.environmentId;
  const threadId = input.threadRef?.threadId ?? null;
  const projectId = input.projectId ?? null;
  const cwd = input.cwd ?? null;

  return useMemo(
    () => (environmentId ? { environmentId, threadId, projectId, cwd } : null),
    [cwd, environmentId, projectId, threadId],
  );
}

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

const NO_ENVIRONMENTS: ReadonlyArray<EnvironmentId> = [];

/**
 * The skills, connected apps, and enabled MCP servers a person can tag, with their names.
 * An app with several accounts is one row: the bot picks the account.
 */
export function useBotPromptMentionResources(
  environmentId: EnvironmentId | null,
): ReadonlyArray<BotPromptMentionResource> {
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? NO_ENVIRONMENT));

  const composio = useEnvironmentQuery(
    environmentId ? serverEnvironment.composioStatus({ environmentId, input: {} }) : null,
  );

  return useMemo(() => {
    const skills = (snapshot?.libraryFolders ?? [])
      .filter((folder) => folder.parentId === LIBRARY_SKILLS_FOLDER_ID)
      .map(
        (folder): BotPromptMentionResource => ({
          kind: "skill",
          id: folder.id,
          label: folder.title,
        }),
      );

    const apps = (composio.data?.connections ?? [])
      .filter((connection) => connection.status === "ACTIVE")
      .filter(
        (connection, index, all) =>
          all.findIndex((other) => other.toolkitSlug === connection.toolkitSlug) === index,
      )
      .map(
        (connection): BotPromptMentionResource => ({
          kind: "app",
          id: connection.toolkitSlug,
          label: connection.toolkitName ?? connection.toolkitSlug,
          ...(connection.logoUrl ? { logoUrl: connection.logoUrl } : {}),
        }),
      );

    const mcps = (snapshot?.mcpServers ?? [])
      .filter((server) => server.enabled)
      .map(
        (server): BotPromptMentionResource => ({
          kind: "mcp",
          id: server.id,
          label: server.name,
        }),
      );

    return [...skills, ...apps, ...mcps];
  }, [composio.data, snapshot]);
}

/** A tagged skill, app, or MCP server's name, or a stand-in when this person cannot see it. */
export function useBotPromptResourceLabel(environmentId: EnvironmentId | null) {
  const { t } = useI18n();
  const resources = useBotPromptMentionResources(environmentId);

  return useCallback(
    (kind: ComposerResourceMentionKind, id: string) =>
      resources.find((resource) => resource.kind === kind && resource.id === id)?.label ??
      Match.value(kind).pipe(
        Match.when("skill", () => t("Unknown skill")),
        Match.when("app", () => id),
        Match.when("mcp", () => t("Unknown MCP server")),
        Match.exhaustive,
      ),
    [resources, t],
  );
}

export function botPromptMentionOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

/**
 * The `@` picker. Mounted only while an `@` token is being typed, so the thread
 * shell and settings subscriptions stay off the composer's typing path.
 */
export function BotPromptMentionMenu({
  ref,
  listboxId,
  trigger,
  scope,
  bots,
  everyone = false,
  people,
  onSelect,
  onClose,
  onActiveOptionChange,
}: {
  ref: Ref<BotPromptMentionMenuHandle>;
  listboxId: string;
  trigger: BotPromptMentionTrigger;
  scope: BotPromptMentionScope | null;
  bots: ReadonlyArray<BotPromptMentionBot>;
  everyone?: boolean;
  people?: ReadonlyArray<{ readonly personId: string; readonly displayName: string }>;
  onSelect: (item: BotPromptMentionItem) => void;
  onClose: () => void;
  onActiveOptionChange: (optionId: string | null) => void;
}) {
  const { t } = useI18n();

  const mentionKindDescription: Record<Exclude<BotPromptMentionItem["kind"], "path">, string> = {
    browser: t("Preview browser"),
    bot: t("Bot"),
    everyone: t("Every bot in this group"),
    person: t("Person"),
    thread: t("Chat"),
    skill: t("Skill"),
    app: t("App"),
    mcp: t("MCP server"),
  };

  const browserAccess = useEnvironmentSettings(
    scope?.environmentId ?? NO_ENVIRONMENT,
    (settings) => settings.enableAgentBrowserAccess,
  );

  const shells = useThreadShells();
  const threadQuery = botPromptThreadQuery(trigger.query);
  const search = useThreadSearch(scope ? [scope.environmentId] : NO_ENVIRONMENTS, threadQuery);

  const threads = useMemo(() => {
    if (!scope) return [];

    const matchedIds = new Set(
      search.matches.flatMap((match) =>
        match.environmentId === scope.environmentId ? [match.threadId] : [],
      ),
    );

    return rankComposerThreadMentions(
      shells.filter((shell) => shell.environmentId === scope.environmentId),
      {
        query: threadQuery,
        currentThreadId: scope.threadId,
        currentProjectId: scope.projectId,
        matchedIds,
      },
    );
  }, [scope, search.matches, shells, threadQuery]);

  // `@chat:` names a chat outright; any other query may also be a workspace path.
  const searchesPaths = scope !== null && !isBotPromptThreadQuery(trigger.query);

  const pathSearch = useComposerPathSearch({
    environmentId: scope?.environmentId ?? null,
    cwd: searchesPaths ? scope.cwd : null,
    query: searchesPaths ? trigger.query : null,
  });

  const resources = useBotPromptMentionResources(scope?.environmentId ?? null);

  const items = buildBotPromptMentionItems({
    query: trigger.query,
    browserAvailable: scope !== null && browserAccess,
    browserLabel: t("Browser"),
    everyone,
    ...(people ? { people } : {}),
    bots,
    resources,
    threads,
    paths: pathSearch.entries,
  });

  const [active, setActive] = useState({ query: trigger.query, index: 0 });

  const activeIndex =
    active.query === trigger.query ? Math.min(active.index, Math.max(0, items.length - 1)) : 0;

  const activeOptionId = items.length > 0 ? botPromptMentionOptionId(listboxId, activeIndex) : null;

  useEffect(() => {
    onActiveOptionChange(activeOptionId);
  }, [activeOptionId, onActiveOptionChange]);
  useEffect(() => () => onActiveOptionChange(null), [onActiveOptionChange]);

  useImperativeHandle(
    ref,
    () => ({
      handleKeyDown: (event) => {
        if (event.nativeEvent.isComposing) return false;

        if (event.key === "Escape") {
          onClose();

          return true;
        }

        if (items.length === 0) return false;

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const step = event.key === "ArrowDown" ? 1 : -1;
          setActive({
            query: trigger.query,
            index: (activeIndex + step + items.length) % items.length,
          });

          return true;
        }

        if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
          const item = items[activeIndex];

          if (item) onSelect(item);

          return true;
        }

        return false;
      },
    }),
    [activeIndex, items, onClose, onSelect, trigger.query],
  );

  if (items.length === 0) return null;

  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label={t("Mention")}
      data-testid="bot-prompt-mention-menu"
      className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      {items.map((item, index) => {
        const Icon = Match.value(item).pipe(
          Match.when({ kind: "browser" }, () => RiGlobalLine),
          Match.when({ kind: "bot" }, () => RiAtLine),
          Match.when({ kind: "everyone" }, () => RiTeamLine),
          Match.when({ kind: "person" }, () => RiUserLine),
          Match.when({ kind: "path" }, () => RiFileLine),
          Match.when({ kind: "skill" }, () => RiSparkling2Line),
          Match.when({ kind: "mcp" }, () => RiPuzzleLine),
          Match.orElse(() => RiChat3Line),
        );

        return (
          <div
            key={item.key}
            id={botPromptMentionOptionId(listboxId, index)}
            role="option"
            aria-selected={index === activeIndex}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              index === activeIndex && "bg-accent text-accent-foreground",
            )}
            // Keep focus in the prompt so the caret and draft stay put.
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => {
              if (index !== activeIndex) setActive({ query: trigger.query, index });
            }}
            onClick={() => onSelect(item)}
          >
            {item.kind === "app" ? (
              <AppLogo src={item.logoUrl} name={item.label} className="size-4" />
            ) : (
              <Icon aria-hidden="true" className="size-4 shrink-0 opacity-70" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {item.kind === "browser" ? t("Browser") : item.label}
            </span>
            <span className="min-w-0 shrink truncate text-xs text-muted-foreground">
              {item.kind === "path"
                ? item.directory
                : item.kind === "bot" && !item.canTakeWork
                  ? [item.detail, t("Cannot take handed-off work")].filter(Boolean).join(", ")
                  : item.kind === "bot" && item.detail !== null
                    ? item.detail
                    : mentionKindDescription[item.kind]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const MENTION_CHIP_PATTERN = /(^|\s)@(browser|chat:|bot:|skill:|app:|mcp:)/;

/** Cheap check so the chip strip, and its thread shell subscription, mount only when needed. */
export function draftHasMentionChips(draft: string): boolean {
  return MENTION_CHIP_PATTERN.test(draft);
}

/** The browser, chat, exact-bot, skill, app, and MCP server mentions in the draft, each with a remove button. */
export function BotPromptMentionChips({
  draft,
  bots,
  environmentId = null,
  onRemove,
}: {
  draft: string;
  bots: ReadonlyArray<BotPromptMentionBot>;
  environmentId?: EnvironmentId | null;
  onRemove: (chip: BotPromptMentionChip) => void;
}) {
  const { t } = useI18n();
  const shells = useThreadShells();
  const resourceLabel = useBotPromptResourceLabel(environmentId);

  const chips = useMemo(() => {
    const titles = new Map<string, string>(shells.map((shell) => [shell.id, shell.title]));

    return botPromptMentionChips(
      draft,
      (threadId) => titles.get(threadId) ?? t("Unknown chat"),
      (botId) => bots.find((bot) => bot.id === botId)?.name ?? t("Unknown bot"),
      resourceLabel,
    ).map((chip) => (chip.kind === "browser" ? { ...chip, label: t("Browser") } : chip));
  }, [bots, draft, resourceLabel, shells, t]);

  if (chips.length === 0) return null;

  return (
    <ul
      aria-label={t("Mentions")}
      className="flex flex-wrap gap-1.5 px-3 pt-3 text-15px"
      data-testid="bot-prompt-mention-chips"
    >
      {chips.map((chip) => {
        const Icon = Match.value(chip).pipe(
          Match.when({ kind: "browser" }, () => RiGlobalLine),
          Match.when({ kind: "bot" }, () => RiAtLine),
          Match.when({ kind: "skill" }, () => RiSparkling2Line),
          Match.when({ kind: "mcp" }, () => RiPuzzleLine),
          Match.when({ kind: "app" }, () => RiPuzzleLine),
          Match.orElse(() => RiChat3Line),
        );

        return (
          <li key={chip.key} className={COMPOSER_INLINE_CHIP_CLASS_NAME}>
            <Icon aria-hidden="true" className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME} />
            <span className={CHAT_INLINE_CHIP_LABEL_CLASS_NAME}>{chip.label}</span>
            <button
              type="button"
              aria-label={t("Remove {name}", { name: chip.label })}
              className={COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME}
              onClick={() => onRemove(chip)}
            >
              <RiCloseLine aria-hidden="true" className="size-full" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
