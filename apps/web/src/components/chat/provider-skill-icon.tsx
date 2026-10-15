import {
  RiShapesLine,
  RiFolderLine,
  RiBox3Line,
  RiSettings3Line,
  RiUserLine,
  type RemixiconComponentType,
} from "@remixicon/react";
import {
  resolveProviderSkillSourceKind,
  resolveProviderSkillTextIcon,
  type ProviderSkillSourceKind,
} from "@otto/client-runtime/providerSkills";
import type { ServerProviderSkill } from "@otto/contracts";

const SKILL_SOURCE_ICON_BY_KIND: Record<ProviderSkillSourceKind, RemixiconComponentType> = {
  app: RiShapesLine,
  repo: RiFolderLine,
  project: RiFolderLine,
  personal: RiUserLine,
  system: RiSettings3Line,
  other: RiBox3Line,
};

/**
 * Draws the skill's own emoji icon, or the glyph for where the skill was
 * loaded from when the provider reported none it can show. Decorative: the
 * surrounding row or chip carries the accessible name.
 */
export function ProviderSkillIcon(props: {
  skill: Pick<ServerProviderSkill, "icon" | "path" | "scope">;
  className?: string;
}) {
  const textIcon = resolveProviderSkillTextIcon(props.skill);

  if (textIcon) {
    return (
      <span aria-hidden="true" className={props.className} data-skill-icon="own">
        {textIcon}
      </span>
    );
  }

  const Icon = SKILL_SOURCE_ICON_BY_KIND[resolveProviderSkillSourceKind(props.skill)];

  return (
    <span aria-hidden="true" className={props.className} data-skill-icon="source">
      {/* text-current keeps the host tint; menu rows otherwise mute bare svgs. */}
      <Icon className="text-current" />
    </span>
  );
}
