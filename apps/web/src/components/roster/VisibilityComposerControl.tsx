import type { Visibility } from "@otto/contracts";
import { RiGlobalLine, RiLockLine } from "@remixicon/react";

import { useI18n } from "../../i18n";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlIcon,
} from "../chat/ComposerControl";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";

const VISIBILITIES = ["user", "organization"] as const satisfies readonly Visibility[];

const visibilityIcon = (visibility: Visibility) =>
  visibility === "user" ? RiLockLine : RiGlobalLine;

/** Otto: Who sees a new chat or routine, Only me (the default) or the Team, in the composer. */
export function VisibilityComposerControl({
  value,
  onChange,
}: {
  readonly value: Visibility;
  readonly onChange: (visibility: Visibility) => void;
}) {
  const { t } = useI18n();

  const label = (visibility: Visibility) => (visibility === "user" ? t("Only me") : t("Team"));

  return (
    <Menu>
      <MenuTrigger
        render={<ComposerControl aria-label={t("Visibility")} className="max-w-52 min-w-0" />}
      >
        <ComposerControlIcon icon={visibilityIcon(value)} />
        <span className="min-w-0 truncate">{label(value)}</span>
        <ComposerControlChevron />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup value={value} onValueChange={(next: Visibility) => onChange(next)}>
          {VISIBILITIES.map((visibility) => (
            <MenuRadioItem key={visibility} value={visibility} closeOnClick>
              <span className="flex items-center gap-2">
                <ComposerControlIcon icon={visibilityIcon(visibility)} />
                {label(visibility)}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
