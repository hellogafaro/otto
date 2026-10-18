import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScopedThreadRef } from "@otto/contracts";

import { canManageChannels } from "../../channel-access";
import { useChatShell } from "../../lib/archived-threads-state";
import { environmentPeopleAtom } from "../../state/bots";
import { useEnvironmentSessionState } from "../../state/session";
import { useRosterStore } from "../roster/roster-store";
import { groupPersonMembers } from "../roster/roster.logic";

/**
 * Otto: Whether this person may archive or unarchive the chat, as the server decides it: any
 * DM, and a group chat only for whoever started it (the group's first person for an older
 * chat) or an admin.
 */
export function useCanArchiveChat(
  threadRef: ScopedThreadRef | null,
  groupId: string | null,
): boolean {
  // SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
  const environmentId = (threadRef?.environmentId ?? "") as EnvironmentId;
  const shell = useChatShell(threadRef).shell;
  const people = useAtomValue(environmentPeopleAtom(environmentId));
  const session = useEnvironmentSessionState(environmentId);
  const group = useRosterStore((state) => state.groups.find((entry) => entry.id === groupId));

  if (groupId === null || canManageChannels(session.data)) return true;

  const starter = shell?.createdBy ?? (group ? groupPersonMembers(group)[0]?.personId : undefined);

  return starter !== undefined && starter === people.current?.id;
}
