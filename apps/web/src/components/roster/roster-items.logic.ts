/** A sidebar row: a bot, a group, or one bot chat (its thread id) pinned to Pins. */
export type RosterItemRef =
  | { kind: "bot"; id: string }
  | { kind: "group"; id: string }
  | { kind: "chat"; id: string };

export function rosterItemKey(item: RosterItemRef): string {
  return `${item.kind}:${item.id}`;
}

export function rosterItemsEqual(left: RosterItemRef, right: RosterItemRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

/** Groups and individual chats can sit in Pins. Bots cannot. */
export function isRosterPinnable(item: RosterItemRef): boolean {
  return item.kind !== "bot";
}

/** Shift an item by one slot in a visible zone. Null when it cannot move. */
export function moveRosterItemInOrder(
  order: readonly RosterItemRef[],
  item: RosterItemRef,
  delta: -1 | 1,
): RosterItemRef[] | null {
  const index = order.findIndex((candidate) => rosterItemsEqual(candidate, item));
  const destination = index + delta;

  if (index < 0 || destination < 0 || destination >= order.length) return null;
  const next = [...order];
  const [moved] = next.splice(index, 1);

  if (!moved) return null;
  next.splice(destination, 0, moved);

  return next;
}

/** Reconstruct mixed section order from the persisted group-then-bot arrays. */
export function rosterSectionItems(section: {
  readonly botIds: readonly string[];
  readonly groupIds?: readonly string[];
  readonly items?: readonly RosterItemRef[] | undefined;
}): RosterItemRef[] {
  if (section.items && section.items.length > 0) return [...section.items];

  return [
    ...(section.groupIds ?? []).map((id) => ({ kind: "group" as const, id })),
    ...section.botIds.map((id) => ({ kind: "bot" as const, id })),
  ];
}

/** A roster row and the list it sits in: Pins first, then the rest. */
export type RosterEntry = { readonly item: RosterItemRef; readonly zone: "pinned" | "unassigned" };
