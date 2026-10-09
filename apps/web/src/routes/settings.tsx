import {
  type RemixiconComponentType,
  RiAddLine,
  RiArrowRightSLine,
  RiBuilding2Line,
  RiCpuLine,
  RiNotification3Line,
  RiRobot3Line,
  RiTeamLine,
  RiUserLine,
} from "@remixicon/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import {
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { type ReactNode, useState } from "react";
import { useConfirm } from "@/components/confirm";
import { IconAction } from "@/components/icon-action";
import { RiConnectorLine } from "@/components/icons";
import { NativeProviderSettings as ModelSettings } from "@/components/native-provider-settings";
import { Page } from "@/components/page";
import { QueryState } from "@/components/query-state";
import { SectionSidebar } from "@/components/section-sidebar";
import { ActorAvatar } from "@/components/task-meta";
import {
  ConnectionSettings,
  NewConnection,
} from "@/features/settings/connections";
import {
  Choice,
  Group,
  Row,
  SaveState,
  SettingsDialog,
  SettingsField,
  SettingsFilters,
  SettingsInput,
  SettingsPaging,
  useSettingsAction,
  useSettingsCreation,
  useSettingsList,
} from "@/features/settings/controls";
import { client, read } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";
import { AgentCreateDialog } from "@/routes/agent-settings";

export { Choice, Group, Row, useAutosave } from "@/features/settings/controls";

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
  Object.hasOwn(sections, value);

export function SettingsSidebar() {
  const matchRoute = useMatchRoute();
  return (
    <SectionSidebar title="Settings">
      {(["Account", "Workspace"] as const).map((group) => (
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
export function SettingsPage({ section }: { section: SettingsSection }) {
  const { workspace, workspaceId } = useWorkspace();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<SettingsSection | null>(null);
  const open = dialog === section;
  const setOpen = (next: boolean) => setDialog(next ? section : null);
  const writer = workspace.role !== "viewer";
  const admin = workspace.role === "owner" || workspace.role === "admin";
  const adds = {
    connections: "New connection",
    members: "Invite",
    agents: "New agent",
  };
  const add = section in adds ? adds[section as keyof typeof adds] : undefined;
  const allowed = section === "members" ? admin : writer;
  const Body = bodies[section];
  return (
    <Page
      title={sections[section].label}
      actions={
        add &&
        allowed && (
          <IconAction
            label={add}
            icon={RiAddLine}
            onClick={() => setOpen(true)}
          />
        )
      }
    >
      <div key={`${workspaceId}:${section}`} className="flex flex-col gap-8">
        <Body />
        {section === "connections" && (
          <NewConnection open={open} onOpenChange={setOpen} />
        )}
        {section === "members" && (
          <InviteMember open={open} onOpenChange={setOpen} />
        )}
        {section === "agents" && (
          <AgentCreateDialog
            open={open}
            onOpenChange={setOpen}
            onCreated={(agentId) => {
              void navigate({
                to: "/settings/agents/$agentId",
                params: { agentId },
              });
            }}
          />
        )}
      </div>
    </Page>
  );
}
function ProfileSettings() {
  const { user, invalidate } = useWorkspace();
  const session = authClient.useSession();
  const me = session.data?.user;
  const initials = user.name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("");
  const update = async (change: { name?: string; image?: string | null }) => {
    if (change.name !== undefined && !change.name.trim())
      throw new Error("Enter your name.");
    if (change.image) {
      let url: URL;
      try {
        url = new URL(change.image);
      } catch {
        throw new Error("Enter a valid HTTPS image URL.");
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error(
          "Use a public HTTPS image URL without credentials, query parameters or fragments.",
        );
    }
    const result = await authClient.updateUser(change);
    if (result.error)
      throw new Error(result.error.message ?? "Unable to update your profile.");
    await session.refetch();
    await invalidate();
  };
  return (
    <>
      <Group>
        <Row
          title="Photo"
          description="Use a public HTTPS image URL. Photo uploads are not available."
        >
          <Avatar size="md">
            <AvatarImage src={me?.image ?? undefined} alt={user.name} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <SettingsInput
            label="Photo URL"
            initial={me?.image ?? ""}
            maxLength={2048}
            save={(image) => update({ image: image || null })}
          />
        </Row>
        <Row title="Name" description="Shown to your teammates and agents.">
          <SettingsInput
            label="Name"
            initial={user.name}
            save={(name) => update({ name: name.trim() })}
          />
        </Row>
        <Row title="Email" description="Email changes are not available.">
          <span className="text-sm text-muted-foreground">{user.email}</span>
        </Row>
      </Group>
      <Group title="Danger zone">
        <Row
          title="Delete account"
          description="Account deletion is not enabled on this server."
        >
          <Button variant="outline" size="compact" disabled>
            Unavailable
          </Button>
        </Row>
      </Group>
    </>
  );
}
function NotificationSettings() {
  return (
    <Group>
      {[
        "Mentions",
        "Questions and reviews",
        "Failed runs",
        "Assignments and shares",
      ].map((title) => (
        <Row
          key={title}
          title={title}
          description="Notification preferences are not available yet."
        >
          <span className="text-sm text-muted-foreground">Unavailable</span>
        </Row>
      ))}
    </Group>
  );
}
function WorkspaceSettings() {
  const { workspace } = useWorkspace();
  return (
    <>
      <Group>
        <Row
          title="Name"
          description="Workspace name editing is not available."
        >
          <span>{workspace.title}</span>
        </Row>
        <Row title="Your role">
          <span>{workspace.role}</span>
        </Row>
      </Group>
      <Group title="Danger zone">
        <Row
          title="Delete workspace"
          description="Workspace deletion is not available."
        >
          <Button variant="outline" size="compact" disabled>
            Unavailable
          </Button>
        </Row>
      </Group>
    </>
  );
}
function AgentSettings() {
  const { api, workspaceId } = useWorkspace();
  const directory = useDirectory();
  const sorts = { title: "Name", createdAt: "Created", updatedAt: "Updated" };
  const list = useSettingsList(sorts, "title");
  const archived = list.params.get("archived") === "true" ? "true" : "false";
  const query = useQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "settings",
      "agents",
      list.request,
      archived,
    ],
    queryFn: async () =>
      read(
        await api.agents.$get({
          param: { workspaceId },
          query: { ...list.request, archived },
        }),
      ),
  });
  return (
    <>
      <SettingsFilters>
        <Choice
          label="Agent archive filter"
          value={archived}
          options={{ false: "Current agents", true: "Archived agents" }}
          onChange={(archived) => list.update({ archived })}
        />
      </SettingsFilters>
      <QueryState
        pending={query.isPending}
        error={query.error}
        retry={query.refetch}
      />
      {query.data && !query.error && (
        <>
          <Group>
            {query.data.items.map((agent) => (
              <Row
                key={agent.id}
                title={agent.title}
                description={directory.actorOf(agent.createdBy).name}
                media={<ActorAvatar actorId={agent.id} size="default" />}
                render={
                  <Link
                    to="/settings/agents/$agentId"
                    params={{ agentId: agent.id }}
                  />
                }
              >
                <span className="text-sm text-muted-foreground">
                  {agent.visibility === "user" ? "Only you" : "Workspace"}
                </span>
                <RiArrowRightSLine className="size-3.5 text-muted-foreground" />
              </Row>
            ))}
            {!query.data.items.length && (
              <Row
                title="No agents"
                description="Agents you create show up here."
              />
            )}
          </Group>
          <SettingsPaging
            next={query.data.next}
            after={list.after}
            change={(after) => list.update({ after })}
          />
        </>
      )}
    </>
  );
}
function MemberSettings() {
  const { api, workspaceId, workspace } = useWorkspace();
  const sorts = { name: "Name" };
  const list = useSettingsList(sorts, "name");
  const role = (["owner", "admin", "contributor", "viewer"] as const).find(
    (role) => role === list.params.get("role"),
  );
  const members = useQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "settings",
      "members",
      list.request,
      role,
    ],
    queryFn: async () =>
      read(
        await api.members.$get({
          param: { workspaceId },
          query: { ...list.request, role },
        }),
      ),
  });
  return (
    <>
      <SettingsFilters>
        <Choice
          label="Role filter"
          value={role ?? "all"}
          options={{
            all: "All roles",
            owner: "Owner",
            admin: "Admin",
            contributor: "Contributor",
            viewer: "Viewer",
          }}
          onChange={(role) =>
            list.update({ role: role === "all" ? undefined : role })
          }
        />
      </SettingsFilters>
      <QueryState
        pending={members.isPending}
        error={members.error}
        retry={members.refetch}
      />
      {members.data && !members.error && (
        <>
          <Group>
            {members.data.items.map((member) => (
              <MemberRow
                key={`${member.userId}:${member.role}`}
                member={member}
              />
            ))}
            {!members.data.items.length && (
              <Row
                title="No members"
                description="Members with this role show up here."
              />
            )}
          </Group>
          <SettingsPaging
            next={members.data.next}
            after={list.after}
            change={(after) => list.update({ after })}
          />
        </>
      )}
      {(workspace.role === "owner" || workspace.role === "admin") && (
        <InvitationActions />
      )}
      <AcceptInvitation />
    </>
  );
}
type Member = ReturnType<typeof useDirectory>["members"][number];
function MemberRow({ member }: { member: Member }) {
  const { api, workspaceId, workspace, user } = useWorkspace();
  const queryClient = useQueryClient();
  const action = useSettingsAction();
  const confirm = useConfirm();
  const canManage =
    member.role !== "owner" &&
    (workspace.role === "owner" ||
      (workspace.role === "admin" && member.role !== "admin"));
  const options =
    workspace.role === "owner"
      ? { admin: "Admin", contributor: "Contributor", viewer: "Viewer" }
      : { contributor: "Contributor", viewer: "Viewer" };
  return (
    <Row
      title={member.name}
      description={member.userId === user.id ? "You" : undefined}
      media={<ActorAvatar actorId={member.userId} size="default" />}
    >
      <div className="flex flex-col items-end gap-2">
        <div className="flex gap-2">
          {canManage && member.role !== "owner" && member.role in options ? (
            <Choice
              label={`${member.name} role`}
              value={member.role}
              options={options}
              disabled={action.pending}
              onChange={async (role) => {
                if (role === member.role) return;
                const yes = await confirm({
                  title: `Change ${member.name}'s role?`,
                  description:
                    "Viewer access requires transferring open tasks and schedules first.",
                  action: "Change role",
                });
                if (yes)
                  await action.perform(async () => {
                    await read(
                      await api.members[":userId"].role.$post({
                        param: { workspaceId, userId: member.userId },
                        json: { role },
                      }),
                    );
                    if (member.userId === user.id)
                      await queryClient.invalidateQueries({
                        queryKey: ["workspaces"],
                      });
                  }, "Role saved");
              }}
            />
          ) : (
            <span className="text-sm text-muted-foreground">{member.role}</span>
          )}
          {canManage && (
            <Button
              variant="outline"
              size="compact"
              disabled={action.pending}
              onClick={async () => {
                const yes = await confirm({
                  title: `Remove ${member.name}?`,
                  description:
                    "Workspace access will be revoked. Transfer their open tasks and schedules first.",
                  action: "Remove",
                  destructive: true,
                });
                if (yes)
                  await action.perform(async () => {
                    await read(
                      await api.members[":userId"].$delete({
                        param: { workspaceId, userId: member.userId },
                      }),
                    );
                    if (member.userId === user.id)
                      await queryClient.invalidateQueries({
                        queryKey: ["workspaces"],
                      });
                  }, "Member removed");
              }}
            >
              Remove
            </Button>
          )}
        </div>
        <SaveState {...action} />
      </div>
    </Row>
  );
}
const roleOptions = {
  admin: "Admin",
  contributor: "Contributor",
  viewer: "Viewer",
};
function InviteMember({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { api, workspaceId, workspace } = useWorkspace();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "contributor" | "viewer">(
    "contributor",
  );
  const [result, setResult] = useState<{
    id: string;
    delivery: string;
    email: string;
  } | null>(null);
  const action = useSettingsCreation();
  return (
    <>
      {result && (
        <Group title="Created invitation">
          <Row
            title={result.email}
            description={`Delivery: ${result.delivery}. Invitation ID: ${result.id}`}
          />
        </Group>
      )}
      <SettingsDialog
        title="Invite member"
        description="The recipient must sign in with this email and verify it before accepting."
        open={open}
        onOpenChange={onOpenChange}
        pending={action.pending}
        error={action.error}
        submitDisabled={action.blocked}
        submitLabel="Invite"
        onSubmit={async () => {
          if (
            await action.perform(async () => {
              const invitation = await action.create(() =>
                api.invitations.$post({
                  param: { workspaceId },
                  json: { email: email.trim(), role },
                }),
              );
              if (action.isActive()) setResult(invitation);
            }, "Invitation created")
          ) {
            action.reset();
            setEmail("");
            onOpenChange(false);
          }
        }}
      >
        <SettingsField
          label="Email"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field>
          <FieldLabel>Role</FieldLabel>
          <Choice
            label="Invitation role"
            value={role}
            options={
              workspace.role === "owner"
                ? roleOptions
                : { contributor: "Contributor", viewer: "Viewer" }
            }
            onChange={setRole}
          />
        </Field>
      </SettingsDialog>
    </>
  );
}
function InvitationActions() {
  const { api, workspaceId } = useWorkspace();
  const [id, setId] = useState("");
  const [delivery, setDelivery] = useState<string>();
  const action = useSettingsAction();
  const confirm = useConfirm();
  const valid =
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id);
  return (
    <Group
      title="Invitations"
      description="Saved invitation lists are not available. Use an invitation ID from the creation receipt."
    >
      <Row title="Invitation ID">
        <SettingsField
          label="Invitation ID"
          disabled={action.pending}
          value={id}
          onChange={(event) => {
            setId(event.target.value.trim());
            setDelivery(undefined);
          }}
        />
      </Row>
      <Row
        title="Delivery"
        description={
          delivery
            ? `Delivery: ${delivery}`
            : "Resend is explicit; uncertain delivery may already have sent an email."
        }
      >
        <Button
          variant="outline"
          size="compact"
          disabled={!valid || action.pending}
          onClick={() =>
            action.perform(async () => {
              const result = await read(
                await api.invitations[":id"].send.$post({
                  param: { workspaceId, id },
                }),
              );
              setDelivery(result.delivery);
            })
          }
        >
          Resend
        </Button>
        <Button
          variant="outline"
          size="compact"
          disabled={!valid || action.pending}
          onClick={async () => {
            const yes = await confirm({
              title: "Revoke invitation?",
              description: "The recipient will no longer be able to accept it.",
              action: "Revoke",
              destructive: true,
            });
            if (yes)
              await action.perform(
                async () =>
                  read(
                    await api.invitations[":id"].$patch({
                      param: { workspaceId, id },
                      json: { status: "revoked" },
                    }),
                  ),
                "Invitation revoked",
              );
          }}
        >
          Revoke
        </Button>
      </Row>
      <SaveState {...action} />
    </Group>
  );
}
function AcceptInvitation() {
  const { selectWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [id, setId] = useState("");
  const action = useSettingsAction();
  const valid =
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id);
  return (
    <Group title="Accept invitation">
      <Row
        title="Invitation ID"
        description="Use the ID sent to your verified email."
      >
        <SettingsField
          label="Accept invitation ID"
          disabled={action.pending}
          value={id}
          onChange={(event) => setId(event.target.value.trim())}
        />
        <Button
          variant="outline"
          size="compact"
          disabled={!valid || action.pending}
          onClick={() =>
            action.perform(async () => {
              const result = await read(
                await client.invitations[":id"].accept.$post({ param: { id } }),
              );
              await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
              if (action.isActive()) selectWorkspace(result.workspaceId);
            }, "Invitation accepted")
          }
        >
          Accept
        </Button>
      </Row>
      <SaveState {...action} />
    </Group>
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
