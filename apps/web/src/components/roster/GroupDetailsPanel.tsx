import { type EnvironmentId } from "@otto/contracts";

import { useI18n } from "../../i18n";
import { DetailsAside } from "../DetailsAside";
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

  return (
    <DetailsAside
      open={open}
      onOpenChange={setOpen}
      title={t("Group")}
      testId="group-details-panel"
      labels={{
        sidebar: t("{name} group sidebar", { name: props.group.name }),
        open: t("Open {name} group sidebar", { name: props.group.name }),
        collapse: t("Collapse {name} group sidebar", { name: props.group.name }),
        close: t("Close group sidebar"),
        sheetTitle: t("Edit {name}", { name: props.group.name }),
      }}
    >
      <GroupEditor {...props} />
    </DetailsAside>
  );
}
