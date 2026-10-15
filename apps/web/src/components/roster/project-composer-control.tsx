import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type OrchestrationProjectShell,
  type ProjectId,
  GENERAL_PROJECT_ID,
} from "@otto/contracts";
import { RiBox3Line } from "@remixicon/react";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentSnapshotAtom } from "../../state/shell";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlIcon,
} from "../chat/composer-control";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { chatHomeProject } from "./bot-thread-runtime.logic";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

export interface ProjectChoice {
  readonly project: OrchestrationProjectShell | null;
  /** The General project reads as "No project". */
  readonly home: OrchestrationProjectShell | null;
  readonly projects: readonly OrchestrationProjectShell[];
  readonly choose: (projectId: ProjectId) => void;
}

/** The project a new chat or routine starts in: the preset, else No project. */
export function useProjectChoice(presetProjectId?: ProjectId | null): ProjectChoice {
  const environmentId = usePrimaryEnvironmentId();
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? NO_ENVIRONMENT));
  const [chosen, setChosen] = useState<ProjectId | null>(null);
  const projects = snapshot?.projects ?? [];

  const project =
    projects.find((candidate) => candidate.id === (chosen ?? presetProjectId)) ??
    chatHomeProject(projects, () => projects[0] ?? null);

  return {
    project,
    home: projects.find((candidate) => candidate.id === GENERAL_PROJECT_ID) ?? null,
    projects,
    choose: setChosen,
  };
}

/**
 * Otto: The composer's project control: No project (the home project, a chat about
 * nothing in particular) first, then every other project.
 */
export function ProjectComposerControl({ choice }: { readonly choice: ProjectChoice }) {
  const { t } = useI18n();
  const { project, home, projects, choose } = choice;

  if (project === null) return null;

  return (
    <Menu>
      <MenuTrigger
        render={<ComposerControl aria-label={t("Project")} className="max-w-52 min-w-0" />}
      >
        <ComposerControlIcon icon={RiBox3Line} />
        <span className="min-w-0 truncate">
          {project === home ? t("No project") : project.title}
        </span>
        <ComposerControlChevron />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup value={project.id} onValueChange={(next: ProjectId) => choose(next)}>
          {home ? (
            <MenuRadioItem value={home.id} closeOnClick>
              {t("No project")}
            </MenuRadioItem>
          ) : null}
          {projects
            .filter((candidate) => candidate !== home)
            .map((candidate) => (
              <MenuRadioItem key={candidate.id} value={candidate.id} closeOnClick>
                {candidate.title}
              </MenuRadioItem>
            ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
