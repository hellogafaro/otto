import { RiBox3Line, RiListCheck3, RiRobot3Line, RiTeamLine } from "@remixicon/react";
import { useMemo, type ReactNode } from "react";

import { useI18n } from "../../i18n";
import { projectStatus } from "./work.logic";
import { useWorkData } from "./WorkPages";

export type InternalItemType = "task" | "project" | "bot" | "group";

export interface InternalItem {
  readonly key: string;
  readonly type: InternalItemType;
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly hint: string;
}

export function internalItemIcon(type: InternalItemType): ReactNode {
  switch (type) {
    case "task":
      return <RiListCheck3 />;
    case "project":
      return <RiBox3Line />;
    case "bot":
      return <RiRobot3Line />;
    case "group":
      return <RiTeamLine />;
  }
}

/** Everything an @ or a resource can point at inside Otto: open tasks, projects, bots and groups. */
export function useInternalItems(): ReadonlyArray<InternalItem> {
  const { t } = useI18n();
  const { tasks, projects, groups, participants } = useWorkData();

  return useMemo(() => {
    const item = (
      type: InternalItemType,
      id: string,
      label: string,
      href: string,
      hint: string,
    ) => ({
      key: `${type}:${id}`,
      type,
      id,
      label,
      href,
      icon: internalItemIcon(type),
      hint,
    });

    return [
      ...tasks
        .filter((task) => task.status !== "archived")
        .map((task) => item("task", task.id, task.title, `/tasks/${task.id}`, t("Task"))),
      ...projects
        .filter((project) => projectStatus(project) !== "archived")
        .map((project) =>
          item("project", project.id, project.title, `/projects/${project.id}`, t("Project")),
        ),
      ...participants.bots.map((bot) => item("bot", bot.id, bot.name, `/bots/${bot.id}`, t("Bot"))),
      ...groups.map((group) =>
        item("group", group.id, group.name, `/groups/${group.id}`, t("Group")),
      ),
    ];
  }, [groups, participants.bots, projects, t, tasks]);
}

/** Items whose label matches the query, prefix matches first, at most `limit`. */
export function matchItems<Item extends { readonly label: string }>(
  items: ReadonlyArray<Item>,
  query: string,
  limit = 8,
): ReadonlyArray<Item> {
  const needle = query.trim().toLowerCase();

  return items
    .filter((item) => item.label.toLowerCase().includes(needle))
    .toSorted(
      (a, b) =>
        Number(!a.label.toLowerCase().startsWith(needle)) -
        Number(!b.label.toLowerCase().startsWith(needle)),
    )
    .slice(0, limit);
}
