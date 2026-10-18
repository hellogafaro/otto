import { RiContrastLine, RiLogoutBoxRLine, RiSettings3Line } from "@remixicon/react";
import { toast } from "sonner";

import { useTheme } from "../../hooks/use-theme";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { PersonAvatar } from "../roster/person-avatar";
import { signOut, useOrganizationAccounts } from "../settings/use-organization-accounts";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { ShortcutKbd } from "../shortcut-kbd";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const COLOR_SCHEMES = ["system", "light", "dark"] as const;

/** The person's picture, or their initials while they have none. */
function AccountAvatar({
  name,
  image,
  className,
}: {
  readonly name: string;
  readonly image: string | null | undefined;
  readonly className: string;
}) {
  if (!image) return <PersonAvatar name={name} className={className} />;

  return <img alt="" src={image} className={cn("shrink-0 object-cover", className)} />;
}

/**
 * Otto: The signed-in person's avatar opens their menu: who and where they are, Settings,
 * Appearance and Log out. The rail shows the avatar alone; the classic sidebar shows a row.
 */
export function AccountMenu({
  presentation,
  onOpenSettings,
}: {
  readonly presentation: "rail" | "row";
  readonly onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const { appearanceMode, setAppearanceMode } = useTheme();
  const { client, state, refresh } = useOrganizationAccounts();
  const { state: sidebarState } = useSidebar();
  const user = state?.user ?? null;
  const name = user ? `${user.firstName} ${user.lastName}`.trim() || user.email : t("Account");
  const rail = presentation === "rail";
  const schemeLabels = { system: t("System"), light: t("Light"), dark: t("Dark") };

  const trigger = rail ? (
    <MenuTrigger
      render={
        <button
          type="button"
          aria-label={name}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-bg-color-shadow duration-(--duration-fast) ease-(--ease-smooth-out) select-none hover:bg-sidebar-wash data-popup-open:bg-sidebar-wash motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring app-region-no-drag"
        />
      }
    >
      <AccountAvatar name={name} image={user?.image} className="size-6 rounded-sm text-10px" />
    </MenuTrigger>
  ) : (
    <MenuTrigger render={<SidebarMenuButton aria-label={name} />}>
      <AccountAvatar name={name} image={user?.image} className="size-6 rounded-sm text-10px" />
      <span className="truncate group-data-[collapsible=icon]:hidden">{name}</span>
    </MenuTrigger>
  );

  const menu = (
    <Menu
      onOpenChange={(open) => {
        if (open) void refresh().catch(() => undefined);
      }}
    >
      <Tooltip>
        <TooltipTrigger render={trigger} />
        {rail || sidebarState === "collapsed" ? (
          <TooltipPopup side="right">{name}</TooltipPopup>
        ) : null}
      </Tooltip>
      <MenuPopup side={rail ? "right" : "top"} align={rail ? "end" : "start"} className="w-60">
        {user ? (
          <>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <AccountAvatar name={name} image={user.image} className="size-8 rounded-md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{name}</p>
                {state?.organization ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {state.organization.name}
                  </p>
                ) : null}
              </div>
            </div>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem onClick={onOpenSettings}>
          <RiSettings3Line aria-hidden />
          {t("Settings")}
          <ShortcutKbd command="settings.open" className="ms-auto" />
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger>
            <RiContrastLine aria-hidden />
            {t("Appearance")}
          </MenuSubTrigger>
          <MenuSubPopup className="w-36">
            <MenuRadioGroup
              value={appearanceMode}
              onValueChange={(next) => {
                const mode = COLOR_SCHEMES.find((scheme) => scheme === next);

                if (mode && !setAppearanceMode(mode)) {
                  toast.error(t("Preferences couldn't be saved"));
                }
              }}
            >
              {COLOR_SCHEMES.map((mode) => (
                <MenuRadioItem key={mode} value={mode}>
                  {schemeLabels[mode]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
        <MenuSeparator />
        <MenuItem
          variant="destructive"
          disabled={!client}
          onClick={async () => {
            if (!client) return;

            if (await signOut(client)) toast.error(t("Couldn't log out"));
          }}
        >
          <RiLogoutBoxRLine aria-hidden />
          {t("Log out")}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );

  return rail ? menu : <SidebarMenuItem className="shrink-0">{menu}</SidebarMenuItem>;
}
