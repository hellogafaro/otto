import { RiMailLine, RiShieldUserLine, RiUserLine } from "@remixicon/react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { createOrganizationAccountsClient } from "@otto/client-runtime/authorization";
import { formatRelativeTime } from "../../timestamp-format";
import { PersonAvatar } from "../roster/person-avatar";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Form } from "../ui/form";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Alert, AlertDescription } from "../ui/alert";
import { Spinner } from "../ui/spinner";
import { SkeletonTableRows } from "../ui/skeleton";
import { DataTable, DataTableChip, type DataTableColumn } from "../ui/data-table";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { matchesMemberSearch, splitPersonName } from "./organization-members.logic";
import { SettingsPageContainer, SettingsPageSkeleton } from "./settings-layout";
import { useOrganizationAccounts } from "./use-organization-accounts";

type AccountsClient = ReturnType<typeof createOrganizationAccountsClient>;

type Member = NonNullable<
  Awaited<ReturnType<AccountsClient["organization"]["listMembers"]>>["data"]
>["members"][number];

type Invitation = NonNullable<
  Awaited<ReturnType<AccountsClient["organization"]["listInvitations"]>>["data"]
>[number];

type Role = "admin" | "member";

/** Members and pending invitations share one table, grouped by `type`. */
type MemberRow =
  | { readonly type: "member"; readonly id: string; readonly member: Member }
  | { readonly type: "invitation"; readonly id: string; readonly invitation: Invitation };

const SEARCH_DEBOUNCE_MS = 300;

const ROLE_LABELS: Record<Role, string> = { admin: "Admin", member: "Member" };

const roleLabel = (role: string) => (role === "admin" ? "Admin" : "Member");

const joinedLabel = (date: Date | string) => {
  const relative = formatRelativeTime(new Date(date).toISOString());

  return relative?.suffix ? relative.value : "now";
};

/** Columns like Tasks: who leads, then email and role chips and when they joined. */
function memberColumns(currentUserId: string | undefined): DataTableColumn<MemberRow>[] {
  return [
    {
      id: "avatar",
      cell: (row) => (
        <PersonAvatar
          name={row.type === "member" ? row.member.user.name : row.invitation.email}
          className="size-5"
        />
      ),
    },
    {
      id: "name",
      type: "title",
      cell: (row) =>
        row.type === "invitation"
          ? row.invitation.email
          : `${row.member.user.name}${row.member.userId === currentUserId ? " (you)" : ""}`,
    },
    {
      id: "details",
      type: "chips",
      cell: (row) => {
        const role = row.type === "member" ? row.member.role : row.invitation.role;

        return (
          <>
            {row.type === "member" ? (
              <DataTableChip>
                <RiMailLine aria-hidden />
                <span className="truncate">{row.member.user.email}</span>
              </DataTableChip>
            ) : null}
            <DataTableChip>
              {role === "admin" ? <RiShieldUserLine aria-hidden /> : <RiUserLine aria-hidden />}
              {roleLabel(role)}
            </DataTableChip>
          </>
        );
      },
    },
    {
      id: "joined",
      type: "time",
      cell: (row) =>
        joinedLabel(row.type === "member" ? row.member.createdAt : row.invitation.createdAt),
    },
  ];
}

export function OrganizationMembersSettings() {
  const { client, state, error: loadError } = useOrganizationAccounts();
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [invitations, setInvitations] = useState<readonly Invitation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  // Otto: open flags stay apart from what a dialog shows, so closing never empties it mid-fade.
  const [removeOpen, setRemoveOpen] = useState(false);
  const [selected, setSelected] = useState<MemberRow | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role>("member");
  const [pending, setPending] = useState(false);
  const organizationId = state?.organization?.id;
  const admin = state?.role === "admin";
  const navigate = useNavigate();
  const { q = "" } = useSearch({ from: "/settings/$section" });
  const [search, setSearch] = useState(q);
  const searchTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  // Otto: the URL owns the search; a link or Back that changes `q` resets the field.
  useEffect(() => {
    setSearch((current) => (current.trim() === q ? current : q));
  }, [q]);

  const changeSearch = (value: string) => {
    setSearch(value);
    window.clearTimeout(searchTimer.current);

    searchTimer.current = window.setTimeout(() => {
      const next = value.trim();

      void navigate({
        to: "/settings/$section",
        params: { section: "members" },
        search: next ? { q: next } : {},
        replace: true,
        resetScroll: false,
      });
    }, SEARCH_DEBOUNCE_MS);
  };

  const load = useCallback(async () => {
    if (!client || !organizationId) return;
    const result = await client.organization.listMembers({ query: { organizationId, limit: 100 } });

    if (result.error) throw new Error(result.error.message ?? "Could not load members.");
    setMembers(result.data.members);

    if (admin) {
      const pendingInvitations = await client.organization.listInvitations({
        query: { organizationId },
      });

      if (pendingInvitations.error)
        throw new Error(pendingInvitations.error.message ?? "Could not load invitations.");
      setInvitations(
        pendingInvitations.data.filter((invitation) => invitation.status === "pending"),
      );
    } else setInvitations([]);
    setLoaded(true);
  }, [client, organizationId, admin]);

  useEffect(() => {
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Could not load members."),
    );
  }, [load]);

  const mutate = async (
    operation: () => Promise<{ error: { message?: string | undefined } | null }>,
  ) => {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const result = await operation();

      if (result.error) throw new Error(result.error.message ?? "Could not update members.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update members.");
    } finally {
      setPending(false);
    }
  };

  if (!client || !state?.organization)
    return loadError ? (
      <SettingsPageContainer>{loadError}</SettingsPageContainer>
    ) : (
      <SettingsPageSkeleton />
    );
  const organization = state.organization;
  const adminCount = members.filter((member) => member.role === "admin").length;
  const selectedMember = selected?.type === "member" ? selected.member : null;
  const selectedInvitation = selected?.type === "invitation" ? selected.invitation : null;
  const selectedName = splitPersonName(selectedMember?.user.name ?? "");
  const selectedLastAdmin = selectedMember?.role === "admin" && adminCount === 1;

  const close = () => {
    if (!pending) setProfileOpen(false);
  };

  const rows: MemberRow[] = [
    ...members
      .filter((member) => matchesMemberSearch(q, member.user.name, member.user.email))
      .map((member) => ({ type: "member" as const, id: member.id, member })),
    ...invitations
      .filter((invitation) => matchesMemberSearch(q, invitation.email))
      .map((invitation) => ({ type: "invitation" as const, id: invitation.id, invitation })),
  ];

  const open = (row: MemberRow) => {
    const role = row.type === "member" ? row.member.role : row.invitation.role;

    setSelectedRole(role === "admin" ? "admin" : "member");
    setSelected(row);
    setProfileOpen(true);
  };

  return (
    <SettingsPageContainer>
      {error ? (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            type="search"
            className="max-w-72"
            aria-label="Search members"
            placeholder="Search by name or email"
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
          />
          {admin ? (
            <Button
              className="ms-auto"
              size="sm"
              variant="outline"
              onClick={() => {
                setEmail("");
                setInviteError(null);
                setInviteOpen(true);
              }}
            >
              Invite
            </Button>
          ) : null}
        </div>
        {!loaded ? (
          <SkeletonTableRows label="Loading members" rows={4} />
        ) : rows.length === 0 ? (
          <p className="text-13px text-muted-foreground">
            No one matches this search.{" "}
            <Link
              to="/settings/$section"
              params={{ section: "members" }}
              className="text-foreground underline-offset-2 hover:underline"
            >
              Clear search
            </Link>
          </p>
        ) : (
          <DataTable
            rows={rows}
            columns={memberColumns(state.user?.id)}
            getRowKey={(row) => `${row.type}:${row.id}`}
            onRowClick={open}
            getRowLabel={(row) =>
              row.type === "member"
                ? `${row.member.user.name}, ${roleLabel(row.member.role)}`
                : `${row.invitation.email}, invitation pending`
            }
            groupBy={{
              groups: [
                { id: "member", label: "Members" },
                { id: "invitation", label: "Pending invitations" },
              ],
              getGroupId: (row) => row.type,
            }}
          />
        )}
      </section>
      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          if (!pending) setInviteOpen(open);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>Invite one person to join {organization.name}.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Form
              id="invite-member"
              onSubmit={async (event) => {
                event.preventDefault();

                if (pending) return;
                setPending(true);
                setInviteError(null);

                try {
                  const result = await client.organization.inviteMember({
                    email: email.trim(),
                    role: "member",
                    organizationId: organization.id,
                    resend: true,
                  });

                  if (result.error)
                    throw new Error(result.error.message ?? "Could not invite this person.");
                  await load();
                  setInviteOpen(false);
                  setEmail("");
                } catch (cause) {
                  setInviteError(
                    cause instanceof Error ? cause.message : "Could not invite this person.",
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              <Field>
                <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="teammate@example.com"
                  autoComplete="email"
                  required
                  maxLength={254}
                />
              </Field>
              {inviteError ? (
                <Alert variant="error">
                  <AlertDescription>{inviteError}</AlertDescription>
                </Alert>
              ) : null}
            </Form>
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" disabled={pending} onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="invite-member" disabled={pending || !state.mailConfigured}>
              {pending ? <Spinner /> : null}Invite
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={profileOpen}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{selectedMember ? "Member" : "Invitation"}</DialogTitle>
            <DialogDescription>
              {selectedMember
                ? `Joined ${new Date(selectedMember.createdAt).toLocaleDateString()}`
                : `Invited ${selectedInvitation ? new Date(selectedInvitation.createdAt).toLocaleDateString() : ""}`}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Form
              id="member-profile"
              onSubmit={(event) => {
                event.preventDefault();

                if (!selectedMember) return;
                void mutate(async () => {
                  const result = await client.organization.updateMemberRole({
                    memberId: selectedMember.id,
                    organizationId: organization.id,
                    role: selectedRole,
                  });

                  if (!result.error) setProfileOpen(false);

                  return result;
                });
              }}
            >
              {selectedMember ? (
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="member-first-name">First name</FieldLabel>
                    <Input id="member-first-name" value={selectedName.first} disabled />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="member-last-name">Last name</FieldLabel>
                    <Input id="member-last-name" value={selectedName.last} disabled />
                  </Field>
                </div>
              ) : null}
              <Field>
                <FieldLabel htmlFor="member-email">Email</FieldLabel>
                <Input
                  id="member-email"
                  value={selectedMember?.user.email ?? selectedInvitation?.email ?? ""}
                  disabled
                />
              </Field>
              <Field>
                <FieldLabel>Role</FieldLabel>
                <Select
                  items={ROLE_LABELS}
                  value={selectedRole}
                  disabled={!admin || !selectedMember || selectedLastAdmin || pending}
                  onValueChange={(role) => {
                    if (role === "admin" || role === "member") setSelectedRole(role);
                  }}
                >
                  <SelectTrigger aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {selectedLastAdmin
                    ? "Every organization needs an admin, so the only admin stays an admin."
                    : "Admins can invite, edit and remove members."}
                </FieldDescription>
              </Field>
            </Form>
          </DialogPanel>
          <DialogFooter>
            {admin && !selectedLastAdmin ? (
              <Button
                variant="destructive-outline"
                className="me-auto"
                disabled={pending}
                onClick={() => {
                  if (selectedMember) {
                    setProfileOpen(false);
                    setRemoving(selectedMember);
                    setRemoveOpen(true);

                    return;
                  }

                  if (!selectedInvitation) return;
                  void mutate(async () => {
                    const result = await client.organization.cancelInvitation({
                      invitationId: selectedInvitation.id,
                    });

                    if (!result.error) setProfileOpen(false);

                    return result;
                  });
                }}
              >
                Delete
              </Button>
            ) : null}
            <Button variant="ghost" disabled={pending} onClick={close}>
              {admin && selectedMember ? "Cancel" : "Close"}
            </Button>
            {admin && selectedMember ? (
              <Button
                type="submit"
                form="member-profile"
                disabled={pending || selectedRole === selectedMember.role}
              >
                {pending ? <Spinner /> : null}Save
              </Button>
            ) : null}
            {admin && selectedInvitation ? (
              <Button
                disabled={pending}
                onClick={() =>
                  void mutate(() =>
                    client.organization.inviteMember({
                      email: selectedInvitation.email,
                      role: selectedInvitation.role === "admin" ? "admin" : "member",
                      organizationId: organization.id,
                      resend: true,
                    }),
                  )
                }
              >
                Resend invitation
              </Button>
            ) : null}
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={removeOpen}
        onOpenChange={(open) => {
          if (!open && !pending) setRemoveOpen(false);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Delete member?</DialogTitle>
            <DialogDescription>
              {removing?.user.name} will lose access to this organization. Their existing
              contributions will remain.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={pending} onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (!removing) return;
                void mutate(async () => {
                  const result = await client.organization.removeMember({
                    memberIdOrEmail: removing.id,
                    organizationId: organization.id,
                  });

                  if (!result.error) setRemoveOpen(false);

                  return result;
                });
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SettingsPageContainer>
  );
}
