import {
  type RemixiconComponentType,
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiBuilding2Line,
  RiClaudeFill,
  RiCpuLine,
  RiGithubFill,
  RiNotification3Line,
  RiNotionFill,
  RiOpenaiFill,
  RiPencilLine,
  RiRobot3Line,
  RiTeamLine,
  RiUserLine,
} from "@remixicon/react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import {
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { toast } from "@workspace/ui/components/sonner";
import { Switch } from "@workspace/ui/components/switch";
import { type ReactElement, type ReactNode, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm";
import { useDebounced } from "@/components/debounce";
import { useAskAgent } from "@/components/floating-chat";
import { IconAction } from "@/components/icon-action";
import { RiConnectorLine } from "@/components/icons";
import { Page } from "@/components/page";
import { SectionSidebar } from "@/components/section-sidebar";
import { ActorAvatar, visibilityLooks } from "@/components/task-meta";
import { request } from "@/mock/api";
import {
  agentConfigs,
  memberRoles,
  type Settings,
  saveSetting,
  settings,
} from "@/mock/settings";
import { agents, currentUserId, users } from "@/mock/tasks";

// Settings, as lean as the MVP allows: what is yours (Account) and what the
// workspace shares (Workspace). The theme stays in the profile menu; usage
// and activity belong to a later Reports page.
const sections = {
  profile: { group: "Account", label: "Profile", icon: RiUserLine },
  notifications: {
    group: "Account",
    label: "Notifications",
    icon: RiNotification3Line,
  },
  models: { group: "Account", label: "Models", icon: RiCpuLine },
  connections: {
    group: "Account",
    label: "Connections",
    icon: RiConnectorLine,
  },
  agents: { group: "Account", label: "Agents", icon: RiRobot3Line },
  workspace: { group: "Workspace", label: "General", icon: RiBuilding2Line },
  members: { group: "Workspace", label: "Members", icon: RiTeamLine },
} satisfies Record<
  string,
  { group: string; label: string; icon: RemixiconComponentType }
>;

export type SettingsSection = keyof typeof sections;

export const isSettingsSection = (value: string): value is SettingsSection =>
  value in sections;

// The left panel, like Chats': Account, then Workspace, one row per section.
export function SettingsSidebar() {
  const matchRoute = useMatchRoute();
  const groups = ["Account", "Workspace"] as const;
  return (
    <SectionSidebar title="Settings">
      {groups.map((group) => (
        <div key={group}>
          <SidebarGroupLabel>{group}</SidebarGroupLabel>
          <SidebarMenu>
            {Object.entries(sections)
              .filter(([, section]) => section.group === group)
              .map(([id, { label, icon: Icon }]) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    isActive={Boolean(
                      matchRoute({
                        to: "/settings/$section",
                        params: { section: id },
                        // An agent's page stays under Agents.
                        fuzzy: true,
                      }),
                    )}
                    render={
                      <Link to="/settings/$section" params={{ section: id }} />
                    }
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
          </SidebarMenu>
        </div>
      ))}
    </SectionSidebar>
  );
}

// One section: its title, then its cards. Adding (an agent, a connection, a
// member) asks Otto, like every "New …".
export function SettingsPage({ section }: { section: SettingsSection }) {
  const ask = useAskAgent();
  const adds: Partial<Record<SettingsSection, [string, string]>> = {
    connections: ["New connection", "Connect "],
    agents: ["New agent", "Create an agent that "],
    members: ["Invite", "Invite "],
  };
  const add = adds[section];
  const Body = bodies[section];
  return (
    <Page
      title={sections[section].label}
      actions={
        add && (
          <IconAction
            label={add[0]}
            icon={RiAddLine}
            onClick={() => ask(add[1])}
          />
        )
      }
    >
      <div className="flex flex-col gap-8">
        <Body />
      </div>
    </Page>
  );
}

// A card of settings, under an optional h2 (Activity's size): rows on a
// 12px card, a hairline between two (rows have a 1px border; between two,
// the top one shows). Like every card on a page, it reaches 16px out of the
// page column (its rows' 1px border and 15px padding), so their text sits on
// the title's line.
// An optional line under the heading says what the section holds.
export function Group({
  title,
  description,
  children,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      {title && (
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-medium">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      <div className="-mx-4 flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 [&>[data-slot=item]+[data-slot=item]]:border-t-border">
        {children}
      </div>
    </section>
  );
}

// One setting, the only row: what it is (and a line on it, 12px, 2px under)
// on the left, its control on the right. Rows listing things (agents,
// members, connections) add their avatar or icon on the left; one that opens
// a page renders as its link.
export function Row({
  title,
  description,
  media,
  render,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  media?: ReactNode;
  render?: ReactElement;
  children?: ReactNode;
}) {
  return (
    <Item render={render} className="rounded-none px-[15px]">
      {media && <ItemMedia>{media}</ItemMedia>}
      <ItemContent className="gap-0.5">
        <ItemTitle>{title}</ItemTitle>
        {description && (
          <ItemDescription className="text-xs">{description}</ItemDescription>
        )}
      </ItemContent>
      {children && <ItemActions>{children}</ItemActions>}
    </Item>
  );
}

// A value saved as you go: every change waits 800ms for the next one
// (typing, flipping back), and blur or leaving saves at once. A value back
// where it was sends nothing. Every save says so, in one toast ("Settings
// saved", or the page's own): saves close together refresh it instead of
// stacking.
export function useAutosave<T>(
  initial: T,
  save: (value: T) => void,
  message = "Settings saved",
) {
  const [value, setValue] = useState(initial);
  const last = useRef(JSON.stringify(initial));
  const debounced = useDebounced((next: T) => {
    const json = JSON.stringify(next);
    if (json === last.current) return;
    last.current = json;
    save(next);
    toast.success(message, { id: "settings-saved" });
  });
  const change = (next: T) => {
    setValue(next);
    debounced.run(next);
  };
  return { value, change, flush: debounced.flush };
}

type Key = keyof Settings;
type KeysOf<V> = { [K in Key]: Settings[K] extends V ? K : never }[Key];

// A setting's value, bound to its key.
function useSetting<K extends Key>(key: K) {
  return useAutosave(settings[key], (next) => saveSetting(key, next));
}

// The three controls a row takes, each bound to its setting.
function SettingSwitch({
  name,
  label,
}: {
  name: KeysOf<boolean>;
  label: string;
}) {
  const { value, change } = useSetting(name);
  return (
    <Switch
      aria-label={label}
      checked={value}
      onCheckedChange={(checked) => change(checked)}
    />
  );
}

function SettingInput({
  name,
  label,
}: {
  name: KeysOf<string>;
  label: string;
}) {
  const { value, change, flush } = useSetting(name);
  return (
    <Input
      aria-label={label}
      value={value}
      onChange={(event) => change(event.target.value)}
      onBlur={flush}
      className="w-56"
    />
  );
}

function SettingChoice<K extends KeysOf<string>>({
  name,
  label,
  options,
}: {
  name: K;
  label: string;
  options: Record<Settings[K], string>;
}) {
  const { value, change } = useSetting(name);
  return (
    <Choice label={label} value={value} options={options} onChange={change} />
  );
}

// A choice of a few, as the profile menu's Appearance: a 28px outline button
// (controls nested in a row are 28px, 6px corners) showing the current one,
// opening a radio menu that closes on a pick.
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="compact"
            aria-label={`${label}: ${options[value]}`}
            className="min-w-32 justify-between"
          />
        }
      >
        {options[value]}
        <RiArrowDownSLine data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as T)}
        >
          {(Object.keys(options) as T[]).map((key) => (
            <DropdownMenuRadioItem key={key} value={key} closeOnClick>
              {options[key]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Deleting is the one action a settings page doesn't save as you go: it
// asks first (the stock alert dialog, with a spinner while it works), then
// says it is done.
function DeleteRow({
  type,
  description,
}: {
  /** What goes: "account" reads "Delete account?" and "Account deleted". */
  type: "account" | "workspace";
  description: string;
}) {
  const confirm = useConfirm();
  return (
    <Row title={`Delete ${type}`} description={description}>
      <Button
        variant="destructive"
        size="compact"
        onClick={async () => {
          const yes = await confirm({
            title: `Delete ${type}?`,
            description: "This can't be undone.",
            action: "Delete",
            destructive: true,
            run: request,
          });
          if (yes)
            toast.success(`${type[0].toUpperCase()}${type.slice(1)} deleted`);
        }}
      >
        Delete
      </Button>
    </Row>
  );
}

function ProfileSettings() {
  const me = users[currentUserId];
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <Group>
        <Row title="Photo" description="Shown across Otto.">
          <Avatar size="md">
            <AvatarFallback>{me.initials}</AvatarFallback>
          </Avatar>
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label="Change photo"
            onClick={() => picker.current?.click()}
          >
            <RiPencilLine />
          </Button>
          <input ref={picker} type="file" accept="image/*" hidden />
        </Row>
        <Row title="Name" description="Shown to your teammates and agents.">
          <SettingInput name="name" label="Name" />
        </Row>
        <Row title="Email">
          <span className="text-sm text-muted-foreground">
            johan@hellogafaro.com
          </span>
        </Row>
      </Group>
      <Group title="Danger zone">
        <DeleteRow
          type="account"
          description="Your chats, documents and files go with it."
        />
      </Group>
    </>
  );
}

function NotificationSettings() {
  return (
    <Group>
      <Row
        title="Mentions"
        description="Someone tags you in a chat or a comment."
      >
        <SettingSwitch name="notifyMentions" label="Mentions" />
      </Row>
      <Row
        title="Questions and reviews"
        description="An agent needs your answer or your review."
      >
        <SettingSwitch name="notifyQuestions" label="Questions and reviews" />
      </Row>
      <Row
        title="Failed runs"
        description="An agent's or a schedule's run fails."
      >
        <SettingSwitch name="notifyFailures" label="Failed runs" />
      </Row>
      <Row
        title="Assignments and shares"
        description="A task is assigned to you or a document shared."
      >
        <SettingSwitch
          name="notifyAssignments"
          label="Assignments and shares"
        />
      </Row>
    </Group>
  );
}

// Your AI accounts (subscriptions Otto signs in with, each with its maker's
// logo; one per run, never switched silently) and the model agents use
// unless one says otherwise.
function ModelSettings() {
  return (
    <>
      <Group title="Accounts">
        <Row
          title="ChatGPT"
          description="Connected as johan@hellogafaro.com"
          media={<RiOpenaiFill className="size-5" />}
        >
          <Button variant="outline" size="compact">
            Disconnect
          </Button>
        </Row>
        <Row
          title="Claude"
          description="Not connected"
          media={<RiClaudeFill className="size-5" />}
        >
          <Button variant="outline" size="compact">
            Connect
          </Button>
        </Row>
      </Group>
      <Group title="Default">
        <Row title="Model" description="Agents use it unless set otherwise.">
          <SettingChoice
            name="model"
            label="Model"
            options={{ "gpt-5.5": "GPT-5.5", "gpt-5.5-mini": "GPT-5.5 mini" }}
          />
        </Row>
      </Group>
    </>
  );
}

// External accounts agents may use, each granted to the agents you pick.
function ConnectionSettings() {
  return (
    <Group>
      <Row
        title="GitHub"
        description="Connected as johan-gafaro · 3 agents"
        media={<RiGithubFill className="size-5" />}
      >
        <Button variant="outline" size="compact">
          Disconnect
        </Button>
      </Row>
      <Row
        title="Notion"
        description="MCP server · 1 agent"
        media={<RiNotionFill className="size-5" />}
      >
        <Button variant="outline" size="compact">
          Disconnect
        </Button>
      </Row>
    </Group>
  );
}

// Agents you can use, each opening its own settings; creating one asks Otto.
function AgentSettings() {
  return (
    <Group>
      {(Object.keys(agents) as (keyof typeof agents)[]).map((id) => (
        <Row
          key={id}
          title={agents[id].title}
          description={agents[id].description}
          media={<ActorAvatar actorId={id} size="default" />}
          render={
            <Link to="/settings/agents/$agentId" params={{ agentId: id }} />
          }
        >
          <span className="text-sm text-muted-foreground">
            {visibilityLooks[agentConfigs[id].visibility].label}
          </span>
          <RiArrowRightSLine className="size-3.5 text-muted-foreground" />
        </Row>
      ))}
    </Group>
  );
}

function WorkspaceSettings() {
  return (
    <>
      <Group>
        <Row title="Name" description="Shown to everyone in the workspace.">
          <SettingInput name="workspaceName" label="Workspace name" />
        </Row>
      </Group>
      <Group title="Danger zone">
        <DeleteRow
          type="workspace"
          description="Every project, chat, document and file in it goes too."
        />
      </Group>
    </>
  );
}

const emails: Record<keyof typeof users, string> = {
  u_johan: "johan@hellogafaro.com",
  u_maya: "maya@hellogafaro.com",
};

// People in the workspace (agents are under Agents) and their role.
function MemberSettings() {
  return (
    <Group>
      {(Object.keys(users) as (keyof typeof users)[]).map((id) => (
        <Row
          key={id}
          title={users[id].name}
          description={emails[id]}
          media={<ActorAvatar actorId={id} size="default" />}
        >
          {id === currentUserId ? (
            <span className="text-sm text-muted-foreground">Owner</span>
          ) : (
            <MemberRole id={id} />
          )}
        </Row>
      ))}
    </Group>
  );
}

// A member's role, saved like every setting (the 800ms autosave and its
// toast).
function MemberRole({ id }: { id: string }) {
  const role = useAutosave(memberRoles[id] ?? "member", (next) => {
    memberRoles[id] = next;
  });
  return (
    <Choice
      label="Role"
      value={role.value}
      options={{ admin: "Admin", member: "Member" }}
      onChange={role.change}
    />
  );
}

const bodies: Record<SettingsSection, () => ReactNode> = {
  profile: ProfileSettings,
  notifications: NotificationSettings,
  models: ModelSettings,
  connections: ConnectionSettings,
  agents: AgentSettings,
  workspace: WorkspaceSettings,
  members: MemberSettings,
};
