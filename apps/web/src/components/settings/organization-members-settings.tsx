import { RiMoreLine } from "@remixicon/react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { createOrganizationAccountsClient } from "@otto/client-runtime/authorization";
import { formatRelativeTime } from "../../timestamp-format";
import { PersonAvatar } from "../roster/person-avatar";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Form } from "../ui/form";
import { Field, FieldLabel } from "../ui/field";
import { Alert, AlertDescription } from "../ui/alert";
import { Spinner } from "../ui/spinner";
import { SkeletonTableRows } from "../ui/skeleton";
import { DataTable, type DataTableColumn } from "../ui/data-table";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { matchesMemberSearch } from "./organization-members.logic";
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

const roleLabel = (role: string) => (role === "admin" ? "Admin" : "Member");

const joinedLabel = (date: Date | string) => {
  const relative = formatRelativeTime(new Date(date).toISOString());

  return relative?.suffix ? relative.value : "now";
};

interface MemberActions {
  readonly adminCount: number;
  readonly pending: boolean;
  readonly onRoleChange: (member: Member, role: Role) => void;
  readonly onRemove: (member: Member) => void;
  readonly onResend: (invitation: Invitation) => void;
  readonly onCancel: (invitation: Invitation) => void;
}

/** An admin's More actions on a row: a member's role and removal, or an invitation's resend and cancel. */
function MemberRowActions({
  row,
  actions,
}: {
  readonly row: MemberRow;
  readonly actions: MemberActions;
}) {
  const name = row.type === "member" ? row.member.user.name : row.invitation.email;

  const lastAdmin =
    row.type === "member" && row.member.role === "admin" && actions.adminCount === 1;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Actions for ${name}`}
            disabled={actions.pending}
          />
        }
      >
        <RiMoreLine />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-44">
        {row.type === "member" ? (
          <>
            <MenuRadioGroup
              value={row.member.role}
              onValueChange={(role) => {
                if (role === "admin" || role === "member") actions.onRoleChange(row.member, role);
              }}
            >
              <MenuRadioItem value="admin" disabled={lastAdmin}>
                Admin
              </MenuRadioItem>
              <MenuRadioItem value="member" disabled={lastAdmin}>
                Member
              </MenuRadioItem>
            </MenuRadioGroup>
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              disabled={lastAdmin}
              onClick={() => actions.onRemove(row.member)}
            >
              Remove
            </MenuItem>
          </>
        ) : (
          <>
            <MenuItem onClick={() => actions.onResend(row.invitation)}>Resend invitation</MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => actions.onCancel(row.invitation)}>
              Cancel invitation
            </MenuItem>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}

/** Columns like Tasks: who leads, then email, role and when they joined; admins get More actions. */
function memberColumns({
  currentUserId,
  actions,
}: {
  readonly currentUserId: string | undefined;
  readonly actions: MemberActions | null;
}): DataTableColumn<MemberRow>[] {
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
      id: "email",
      type: "meta",
      cell: (row) => (row.type === "member" ? row.member.user.email : null),
    },
    {
      id: "role",
      type: "meta",
      cell: (row) => roleLabel(row.type === "member" ? row.member.role : row.invitation.role),
    },
    {
      id: "joined",
      type: "time",
      cell: (row) =>
        joinedLabel(row.type === "member" ? row.member.createdAt : row.invitation.createdAt),
    },
    ...(actions
      ? [
          {
            id: "actions",
            cell: (row: MemberRow) => <MemberRowActions row={row} actions={actions} />,
          },
        ]
      : []),
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

  const rows: MemberRow[] = [
    ...members
      .filter((member) => matchesMemberSearch(q, member.user.name, member.user.email))
      .map((member) => ({ type: "member" as const, id: member.id, member })),
    ...invitations
      .filter((invitation) => matchesMemberSearch(q, invitation.email))
      .map((invitation) => ({ type: "invitation" as const, id: invitation.id, invitation })),
  ];

  const columns = memberColumns({
    currentUserId: state.user?.id,
    actions: admin
      ? {
          adminCount,
          pending,
          onRoleChange: (member, role) =>
            void mutate(() =>
              client.organization.updateMemberRole({
                memberId: member.id,
                organizationId: organization.id,
                role,
              }),
            ),
          onRemove: setRemoving,
          onResend: (invitation) =>
            void mutate(() =>
              client.organization.inviteMember({
                email: invitation.email,
                role: invitation.role === "admin" ? "admin" : "member",
                organizationId: organization.id,
                resend: true,
              }),
            ),
          onCancel: (invitation) =>
            void mutate(() =>
              client.organization.cancelInvitation({ invitationId: invitation.id }),
            ),
        }
      : null,
  });

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
            columns={columns}
            getRowKey={(row) => `${row.type}:${row.id}`}
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
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setRemoving(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Remove member?</DialogTitle>
            <DialogDescription>
              {removing?.user.name} will lose access to this organization. Their existing
              contributions will remain.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={pending} onClick={() => setRemoving(null)}>
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

                  if (!result.error) setRemoving(null);

                  return result;
                });
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SettingsPageContainer>
  );
}
