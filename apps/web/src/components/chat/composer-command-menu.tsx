import { Match, Predicate } from "effect";
import {
  formatProviderSkillDisplayName,
  resolveProviderSkillSourceKind,
  type ProviderSkillSourceKind,
} from "@otto/client-runtime/providerSkills";
import {
  type KeybindingCommand,
  type ProjectEntry,
  type ProviderDriverKind,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@otto/contracts";
import type { RemixiconComponentType } from "@remixicon/react";
import { memo, useLayoutEffect, useRef } from "react";

import { type ComposerSlashCommand, type ComposerTriggerKind } from "../../composer-logic";
import { BotAvatarView } from "../roster/bot-avatar-view";
import type { GroupCandidate } from "../roster/group-member-checklist";
import { PersonAvatar } from "../roster/person-avatar";
import { ShortcutKbd } from "../shortcut-kbd";
import { Badge } from "../ui/badge";
import { Command, CommandGroup, CommandGroupLabel, CommandItem, CommandList } from "../ui/command";
import { FileEntryIcon } from "./file-entry-icon";
import { ProviderSkillIcon } from "./provider-skill-icon";

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
      icon?: RemixiconComponentType;
      /** The keys that run the same action outside the composer, shown at the row's end. */
      shortcutCommand?: KeybindingCommand;
    }
  | {
      id: string;
      type: "invitee";
      candidate: GroupCandidate;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "provider-slash-command";
      provider: ProviderDriverKind;
      command: ServerProviderSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      provider: ProviderDriverKind;
      skill: ServerProviderSkill;
      label: string;
      description: string;
    };

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  emptyStateText?: string;
  /** Heads the provider's rows when Otto's own commands are listed above them. */
  providerGroupLabel?: string;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const ottoItems = props.items.filter(
    (item) => item.type === "slash-command" || item.type === "invitee",
  );

  const otherItems = props.items.filter(
    (item) => item.type !== "slash-command" && item.type !== "invitee",
  );

  const row = (item: ComposerCommandItem) => (
    <ComposerCommandMenuItem
      key={item.id}
      item={item}
      triggerKind={props.triggerKind}
      resolvedTheme={props.resolvedTheme}
      isActive={props.activeItemId === item.id}
      onHighlight={props.onHighlightedItemChange}
      onSelect={props.onSelect}
    />
  );

  useLayoutEffect(() => {
    if (!props.activeItemId || !listRef.current) return;

    const el = listRef.current.querySelector<HTMLElement>(
      `[data-composer-item-id="${CSS.escape(props.activeItemId)}"]`,
    );

    el?.scrollIntoView({ block: "nearest" });
  }, [props.activeItemId]);

  return (
    <Command
      autoHighlight={false}
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        props.onHighlightedItemChange(
          Predicate.isString(highlightedValue) ? highlightedValue : null,
        );
      }}
    >
      <div
        ref={listRef}
        className="chat-composer-drawer-surface chat-composer-drawer-attached relative w-full overflow-hidden **:data-[slot=scroll-area-scrollbar]:data-[orientation=vertical]:my-4"
        data-composer-command-drawer="true"
      >
        {props.items.length > 0 ? (
          <CommandList className="max-h-72 scroll-pb-6">
            {ottoItems.length > 0 ? <CommandGroup>{ottoItems.map(row)}</CommandGroup> : null}
            {otherItems.length > 0 ? (
              <CommandGroup>
                {ottoItems.length > 0 && props.providerGroupLabel ? (
                  <CommandGroupLabel className="ms-1">{props.providerGroupLabel}</CommandGroupLabel>
                ) : null}
                {otherItems.map(row)}
              </CommandGroup>
            ) : null}
          </CommandList>
        ) : (
          <div className="px-5 pt-3.5 pb-7">
            <p className="text-secondary-label text-xs">
              {props.isLoading
                ? props.triggerKind === "skill"
                  ? "Searching workspace skills..."
                  : "Searching workspace files..."
                : (props.emptyStateText ??
                  Match.value(props).pipe(
                    Match.when(
                      { triggerKind: "skill" },
                      () => "No skills found. Try / to browse provider commands.",
                    ),
                    Match.when({ triggerKind: "path" }, () => "No matching files or folders."),
                    Match.orElse(() => "No matching command."),
                  ))}
            </p>
          </div>
        )}
      </div>
    </Command>
  );
});

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  triggerKind: ComposerTriggerKind | null;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const skillSourceKind =
    props.item.type === "skill" ? resolveProviderSkillSourceKind(props.item.skill) : null;

  const isSlashSkill =
    props.triggerKind === "slash-command" && props.item.type === "skill" ? props.item.skill : null;

  const CommandIcon = props.item.type === "slash-command" ? props.item.icon : undefined;

  return (
    <CommandItem
      value={props.item.id}
      data-composer-item-id={props.item.id}
      variant={props.isActive ? "composer-active" : "composer"}
      className="cursor-pointer select-none"
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      {props.item.type === "path" ? (
        <FileEntryIcon pathValue={props.item.path} kind={props.item.pathKind} />
      ) : null}
      {props.item.type === "skill" ? (
        <ProviderSkillIcon skill={props.item.skill} className={SKILL_ROW_ICON_CLASS_NAME} />
      ) : null}
      {CommandIcon ? (
        <CommandIcon aria-hidden="true" className="size-4 shrink-0 opacity-70" />
      ) : null}
      {props.item.type === "invitee" ? (
        props.item.candidate.kind === "bot" ? (
          <BotAvatarView
            avatar={props.item.candidate.bot.avatar}
            name={props.item.label}
            className="size-5"
          />
        ) : (
          <PersonAvatar
            name={props.item.label}
            personId={props.item.candidate.person.personId}
            className="size-5"
          />
        )
      ) : null}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 max-w-9/20 shrink-0 truncate font-sans text-xs font-medium">
          {isSlashSkill ? (
            <>
              <span className="text-secondary-label">/skill:</span>
              {formatProviderSkillDisplayName(isSlashSkill)}
            </>
          ) : (
            props.item.label
          )}
        </span>
        <span className="min-w-0 max-w-48ch flex-1 truncate text-left text-secondary-label text-xs">
          {props.item.description}
        </span>
        {props.item.type === "slash-command" && props.item.shortcutCommand ? (
          <ShortcutKbd command={props.item.shortcutCommand} className="ms-auto" />
        ) : null}
        {skillSourceKind ? (
          <SkillSourceBadge
            kind={skillSourceKind}
            showSkillSuffix={props.triggerKind === "skill"}
          />
        ) : null}
      </span>
    </CommandItem>
  );
});

// Same tint as the inline skill chip, a little larger so the row reads as the
// chip it will insert. In em so it follows the row's font size.
const SKILL_ROW_ICON_CLASS_NAME =
  "flex size-1.6em shrink-0 items-center justify-center rounded-0.45em bg-skill/14 text-1em leading-none text-skill-foreground [&>svg]:size-1em";

const SKILL_SOURCE_LABEL_BY_KIND: Record<ProviderSkillSourceKind, string> = {
  app: "App",
  repo: "Repo",
  project: "Project",
  personal: "Personal",
  system: "System",
  other: "Provider",
};

function SkillSourceBadge(props: { kind: ProviderSkillSourceKind; showSkillSuffix: boolean }) {
  return (
    <Badge className="ms-auto" variant="secondary">
      {SKILL_SOURCE_LABEL_BY_KIND[props.kind]}
      {props.showSkillSuffix ? " Skill" : null}
    </Badge>
  );
}
