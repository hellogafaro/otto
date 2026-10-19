import { Match, Predicate } from "effect";
import {
  formatProviderSkillDisplayName,
  resolveProviderSkillSourceKind,
  type ProviderSkillSourceKind,
} from "@otto/client-runtime/providerSkills";
import {
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
        // Same floating shell as the @ context menu, not the attached composer drawer.
        className="relative max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        data-composer-command-menu="true"
      >
        {props.items.length > 0 ? (
          <CommandList className="max-h-none overflow-visible">
            {ottoItems.length > 0 ? <CommandGroup>{ottoItems.map(row)}</CommandGroup> : null}
            {otherItems.length > 0 ? (
              <CommandGroup>
                {ottoItems.length > 0 && props.providerGroupLabel ? (
                  <CommandGroupLabel>{props.providerGroupLabel}</CommandGroupLabel>
                ) : null}
                {otherItems.map(row)}
              </CommandGroup>
            ) : null}
          </CommandList>
        ) : (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
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

  const rightLabel =
    props.item.description.trim().length > 0
      ? props.item.description
      : skillSourceKind
        ? `${SKILL_SOURCE_LABEL_BY_KIND[skillSourceKind]}${props.triggerKind === "skill" ? " Skill" : ""}`
        : "";

  return (
    <CommandItem
      value={props.item.id}
      data-composer-item-id={props.item.id}
      variant={props.isActive ? "menu-active" : "menu"}
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
        <FileEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          className="opacity-70"
        />
      ) : null}
      {props.item.type === "skill" ? (
        <ProviderSkillIcon
          skill={props.item.skill}
          className="flex size-4 shrink-0 items-center justify-center opacity-70 [&>svg]:size-4"
        />
      ) : null}
      {CommandIcon ? (
        <CommandIcon aria-hidden="true" className="size-4 shrink-0 opacity-70" />
      ) : null}
      {props.item.type === "invitee" ? (
        props.item.candidate.kind === "bot" ? (
          <BotAvatarView
            avatar={props.item.candidate.bot.avatar}
            name={props.item.label}
            className="size-4"
          />
        ) : (
          <PersonAvatar
            name={props.item.label}
            personId={props.item.candidate.person.personId}
            className="size-4"
          />
        )
      ) : null}
      <span className="min-w-0 flex-1 truncate">
        {isSlashSkill ? (
          <>
            <span className="text-muted-foreground">/skill:</span>
            {formatProviderSkillDisplayName(isSlashSkill)}
          </>
        ) : (
          props.item.label
        )}
      </span>
      {rightLabel ? (
        <span className="min-w-0 shrink truncate text-xs text-muted-foreground">{rightLabel}</span>
      ) : null}
    </CommandItem>
  );
});

const SKILL_SOURCE_LABEL_BY_KIND: Record<ProviderSkillSourceKind, string> = {
  app: "App",
  repo: "Repo",
  project: "Project",
  personal: "Personal",
  system: "System",
  other: "Provider",
};
