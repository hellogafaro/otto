import { Checkbox } from "../ui/checkbox";
import { BotAvatarView } from "./bot-avatar-view";
import { PersonAvatar } from "./person-avatar";
import type { Bot } from "./types";

export interface GroupPersonOption {
  readonly personId: string;
  readonly displayName: string;
}

export type GroupCandidate =
  | { readonly kind: "bot"; readonly key: string; readonly name: string; readonly bot: Bot }
  | {
      readonly kind: "person";
      readonly key: string;
      readonly name: string;
      readonly person: GroupPersonOption;
    };

/** Bots and people mixed in one alphabetical list; a group needs no label for which is which. */
export function groupCandidates(
  bots: readonly Bot[],
  people: ReadonlyArray<GroupPersonOption>,
): ReadonlyArray<GroupCandidate> {
  return [
    ...bots.map((bot) => ({ kind: "bot" as const, key: `bot:${bot.id}`, name: bot.name, bot })),
    ...people.map((person) => ({
      kind: "person" as const,
      key: `person:${person.personId}`,
      name: person.displayName,
      person,
    })),
  ].toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function GroupMemberChecklist({
  candidates,
  selected,
  onSelectedChange,
}: {
  readonly candidates: ReadonlyArray<GroupCandidate>;
  readonly selected: ReadonlyArray<string>;
  readonly onSelectedChange: (selected: ReadonlyArray<string>) => void;
}) {
  return (
    <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2">
      {candidates.map((candidate) => (
        <label
          key={candidate.key}
          className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted/50"
        >
          <Checkbox
            checked={selected.includes(candidate.key)}
            onCheckedChange={(next) =>
              onSelectedChange(
                next
                  ? [...selected, candidate.key]
                  : selected.filter((key) => key !== candidate.key),
              )
            }
          />
          {candidate.kind === "bot" ? (
            <BotAvatarView avatar={candidate.bot.avatar} name={candidate.name} className="size-7" />
          ) : (
            <PersonAvatar name={candidate.name} className="size-7" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm">{candidate.name}</span>
        </label>
      ))}
    </div>
  );
}
