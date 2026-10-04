import {
  RiComputerLine,
  RiContrastLine,
  RiLogoutBoxRLine,
  RiMoonLine,
  RiSettings3Line,
  RiSunLine,
  RiTeamLine,
} from "@remixicon/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { toast } from "@workspace/ui/components/sonner";
import { useTheme } from "@/components/theme-provider";
import { authClient } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";

const themes = [
  { value: "light", label: "Light", icon: RiSunLine },
  { value: "dark", label: "Dark", icon: RiMoonLine },
  { value: "system", label: "System", icon: RiComputerLine },
] as const;

export function ProfileMenu() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const {
    user,
    workspace,
    workspaces,
    selectWorkspace,
    moreWorkspaces,
    loadingWorkspaces,
    loadWorkspaces,
  } = useWorkspace();
  const queryClient = useQueryClient();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open profile menu"
          />
        }
      >
        <Avatar size="sm">
          <AvatarFallback>
            {user.name
              .split(/\s+/)
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
          {(workspaces.length > 1 || moreWorkspaces) && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <RiTeamLine />
                {workspace.title}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={workspace.id}
                  onValueChange={selectWorkspace}
                >
                  {workspaces.map((item) => (
                    <DropdownMenuRadioItem key={item.id} value={item.id}>
                      {item.title}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                {moreWorkspaces && (
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      disabled={loadingWorkspaces}
                      onClick={async () => {
                        try {
                          await loadWorkspaces();
                        } catch {
                          toast.error("Unable to load more workspaces.");
                        }
                      }}
                    >
                      More workspaces
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}>
            <RiSettings3Line />
            Settings
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <RiContrastLine />
              Appearance
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => setTheme(value)}
              >
                {themes.map(({ value, label, icon: Icon }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <Icon />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            onClick={async () => {
              try {
                const result = await authClient.signOut();
                if (result.error) throw new Error(result.error.message);
                await queryClient.cancelQueries();
                queryClient.clear();
              } catch {
                toast.error("Unable to log out. Try again.");
              }
            }}
          >
            <RiLogoutBoxRLine />
            Log out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
