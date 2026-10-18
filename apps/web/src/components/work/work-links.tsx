import { RiBox3Line, RiListCheck3, RiRobot3Line, RiTeamLine } from "@remixicon/react";
import { useMemo, type ReactNode } from "react";

import { useI18n } from "../../i18n";
import { usePickerTasks } from "../../state/tasks";
import { projectStatus } from "./work.logic";
import { useWorkData } from "./work-pages";

export type EntityType = "task" | "project" | "bot" | "group";

export interface Entity {
  readonly key: string;
  readonly type: EntityType;
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly hint: string;
}

export function entityIcon(type: EntityType): ReactNode {
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

/**
 * Everything an @ or a resource can point at inside Otto: open tasks, projects, bots and groups.
 * Tasks come from the server for `taskQuery`, the text typed so far, and only while a picker
 * asks; null leaves them out.
 */
export function useEntities(taskQuery: string | null): ReadonlyArray<Entity> {
  const { t } = useI18n();
  const { environmentId, projects, groups, participants } = useWorkData();
  const tasks = usePickerTasks(environmentId, taskQuery);

  return useMemo(() => {
    const entity = (type: EntityType, id: string, label: string, href: string, hint: string) => ({
      key: `${type}:${id}`,
      type,
      id,
      label,
      href,
      icon: entityIcon(type),
      hint,
    });

    return [
      ...tasks.map((task) => entity("task", task.id, task.title, `/tasks/${task.id}`, t("Task"))),
      ...projects
        .filter((project) => projectStatus(project) !== "archived")
        .map((project) =>
          entity("project", project.id, project.title, `/projects/${project.id}`, t("Project")),
        ),
      ...participants.bots.map((bot) =>
        entity("bot", bot.id, bot.name, `/bots/${bot.id}`, t("Bot")),
      ),
      ...groups.map((group) =>
        entity("group", group.id, group.name, `/groups/${group.id}`, t("Group")),
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
