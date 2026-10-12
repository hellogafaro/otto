import { useCallback, useEffect, useState } from "react";
import type { createOrganizationAccountsClient } from "@otto/client-runtime/authorization";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Form } from "../ui/form";
import { Field, FieldLabel } from "../ui/field";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import { Spinner } from "../ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
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
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { useOrganizationAccounts } from "./useOrganizationAccounts";

type AccountsClient = ReturnType<typeof createOrganizationAccountsClient>;
type Member = NonNullable<
  Awaited<ReturnType<AccountsClient["organization"]["listMembers"]>>["data"]
>["members"][number];
type Invitation = NonNullable<
  Awaited<ReturnType<AccountsClient["organization"]["listInvitations"]>>["data"]
>[number];
const roles = { admin: "Admin", member: "Member" };

export function OrganizationMembersSettings() {
  const { client, state, error: loadError } = useOrganizationAccounts();
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [invitations, setInvitations] = useState<readonly Invitation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [pending, setPending] = useState(false);
  const organizationId = state?.organization?.id;
  const admin = state?.role === "admin";

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
    return <SettingsPageContainer>{loadError ?? <Spinner />}</SettingsPageContainer>;
  const adminCount = members.filter((member) => member.role === "admin").length;
  const query = search.trim().toLowerCase();
  const visibleMembers = members.filter((member) =>
    `${member.user.name} ${member.user.email}`.toLowerCase().includes(query),
  );

  return (
    <SettingsPageContainer>
      {error ? (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <SettingsSection
        title="Members"
        headerAction={
          admin ? (
            <Button
              onClick={() => {
                setEmail("");
                setInviteError(null);
                setInviteOpen(true);
              }}
            >
              Invite
            </Button>
          ) : null
        }
      >
        <Input
          aria-label="Search members"
          placeholder="Search by name or email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {!loaded ? (
          <Spinner />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                {admin ? (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleMembers.map((member) => {
                const lastAdmin = member.role === "admin" && adminCount === 1;
                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      {member.user.name}
                      {member.userId === state.user?.id ? " (you)" : ""}
                    </TableCell>
                    <TableCell>{member.user.email}</TableCell>
                    <TableCell>
                      {admin ? (
                        <Select
                          items={roles}
                          value={member.role}
                          disabled={pending || lastAdmin}
                          onValueChange={(role) => {
                            if (role !== "admin" && role !== "member") return;
                            void mutate(() =>
                              client.organization.updateMemberRole({
                                memberId: member.id,
                                organizationId: state.organization!.id,
                                role,
                              }),
                            );
                          }}
                        >
                          <SelectTrigger size="sm" aria-label={`Role for ${member.user.name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="member">Member</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary">
                          {member.role === "admin" ? "Admin" : "Member"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{new Date(String(member.createdAt)).toLocaleDateString()}</TableCell>
                    {admin ? (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending || lastAdmin}
                          onClick={() => setRemoving(member)}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {loaded && visibleMembers.length === 0 ? <p>No members match this search.</p> : null}
      </SettingsSection>
      {admin && invitations.length > 0 ? (
        <SettingsSection title="Pending invitations">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell>{invitation.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {invitation.role === "admin" ? "Admin" : "Member"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          void mutate(() =>
                            client.organization.inviteMember({
                              email: invitation.email,
                              role: invitation.role === "admin" ? "admin" : "member",
                              organizationId: state.organization!.id,
                              resend: true,
                            }),
                          )
                        }
                      >
                        Resend
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          void mutate(() =>
                            client.organization.cancelInvitation({ invitationId: invitation.id }),
                          )
                        }
                      >
                        Cancel invitation
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SettingsSection>
      ) : null}
      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          if (!pending) setInviteOpen(open);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              Invite one person to join {state.organization.name}.
            </DialogDescription>
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
                    organizationId: state.organization!.id,
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
                    organizationId: state.organization!.id,
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
