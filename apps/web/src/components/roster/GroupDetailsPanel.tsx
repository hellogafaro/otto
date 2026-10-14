import { type EnvironmentId, ThreadId } from "@otto/contracts";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { DetailsAside } from "../DetailsAside";
import {
  ChatLibraryPanel,
  type ChatSidebarTab,
  useChatSidebarTabs,
} from "../library/ChatLibraryPanel";
import { useThreadShells } from "../../state/entities";
import { findLatestGroupThreadTarget } from "./botThreadRuntime.logic";
import type { Bot, Group } from "./types";
import { useGroupDetailsOpen } from "./detailsPanelOpen";
import { GroupEditor } from "./GroupEditor";

export { groupMemberRemovalHint, isGroupMemberRemovalBlocked } from "./groupMemberRemoval.logic";

export function GroupDetailsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly group: Group;
  readonly bots: readonly Bot[];
  readonly onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useGroupDetailsOpen();
  const [tab, setTab] = useState<ChatSidebarTab>("details");
  const tabs = useChatSidebarTabs();
  const threads = useThreadShells();
  const thread = findLatestGroupThreadTarget(props.group.id, props.environmentId, threads);

  return (
    <DetailsAside
      open={open}
      onOpenChange={setOpen}
      testId="group-details-panel"
      labels={{
        sidebar: t("{name} group sidebar", { name: props.group.name }),
        open: t("Open {name} group sidebar", { name: props.group.name }),
        collapse: t("Collapse {name} group sidebar", { name: props.group.name }),
        close: t("Close group sidebar"),
        sheetTitle: t("Edit {name}", { name: props.group.name }),
      }}
      tabs={{
        items: tabs,
        value: tab,
        onValueChange: (value) => setTab(value === "library" ? "library" : "details"),
      }}
    >
      {tab === "library" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChatLibraryPanel threadId={thread ? ThreadId.make(thread.threadId) : null} />
        </div>
      ) : (
        <GroupEditor {...props} />
      )}
    </DetailsAside>
  );
}
