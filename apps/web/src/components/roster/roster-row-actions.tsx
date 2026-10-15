import { RiMoreLine } from "@remixicon/react";
import type { ReactNode, Ref } from "react";

import { useI18n } from "../../i18n";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Otto: One of a chat row's quick actions, a quiet 24px icon button named by its tooltip. */
export function RosterRowAction({
  label,
  icon,
  onClick,
}: {
  readonly label: string;
  readonly icon: typeof RiMoreLine;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button size="icon-row" variant="sidebar-ghost" aria-label={label} onClick={onClick}>
            <AppIcon icon={icon} className="size-3.5" />
          </Button>
        }
      />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Otto: A chat row's last quick action, More actions; right-clicking the row clicks
 * `triggerRef` so the context menu is this same menu.
 */
export function RosterRowMore({
  label,
  triggerRef,
  children,
}: {
  /** Names the row, such as "Actions for Nova". */
  readonly label: string;
  readonly triggerRef: Ref<HTMLButtonElement>;
  readonly children: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button ref={triggerRef} size="icon-row" variant="sidebar-ghost" aria-label={label}>
                  <AppIcon icon={RiMoreLine} className="size-3.5" />
                </Button>
              }
            />
          }
        />
        <TooltipPopup>{t("More actions")}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end">{children}</MenuPopup>
    </Menu>
  );
}
